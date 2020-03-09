pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../../oracle/implementation/ContractCreator.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/AddressWhitelist.sol";
import "./ExpiringMultiParty.sol";


/**
@title Expiring Multi Party Contract creator
@notice Factory contract to create and register new instances of expiring multiparty contracts. Responsible for
constraining the parameters used to construct a new EMP.
*/
contract ExpiringMultiPartyCreator is ContractCreator, Testable {
    using FixedPoint for FixedPoint.Unsigned;

    struct Params {
        uint expirationTimestamp;
        address collateralAddress;
        address tokenFactoryAddress;
        bytes32 priceFeedIdentifier;
        string syntheticName;
        string syntheticSymbol;
        FixedPoint.Unsigned collateralRequirement;
        FixedPoint.Unsigned disputeBondPct;
        FixedPoint.Unsigned sponsorDisputeRewardPct;
        FixedPoint.Unsigned disputerDisputeRewardPct;
    }

    // @dev: These constraints can evolve over time and are initially constrained to conservative values
    // in this first iteration of an EMP creator:
    // - Whitelist allowed collateral currencies.
    AddressWhitelist public collateralTokenWhitelist;
    // - Last expiration date: 2021-06-30T0:00:00.000Z.
    uint public constant LATEST_EXPIRATION_TIMESTAMP = 1625011200;
    // - Time for pending withdrawal to be disputed: 60 minutes. Lower liveness increases sponsor usability. However, this parameter is a reflection of how long we expect it to take for
    // liquidators to identify that a sponsor is undercollateralized and acquire the tokens needed to liquidate them.
    // This is also a reflection of how long a malicious sponsor would need to maintain a lower-price manipulation to get their withdrawal
    // processed maliciously (if we set it too low, it’s quite easy for malicious sponsors to request a withdrawal and spend gas to prevent
    // other transactions from processing until the withdrawal gets approved). Ultimately, we think liveness is a friction to be minimized,
    // but not critical to the system functioning.
    uint public constant STRICT_WITHDRAWAL_LIVENESS = 3600;
    // - Time for liquidation to be disputed: 60 minutes. Similar reasoning to withdrawal liveness. Lower liveness is more usable for liquidators.
    // However, the parameter is a reflection of how long we expect it to take disputers to notice bad liquidations.
    // Malicious liquidators would also need to attack the base chain for this long to prevent dispute transactions from processing.
    uint public constant STRICT_LIQUIDATION_LIVENESS = 3600;
    // - Minimum dispute bond: 0%. We think this should be positive so that every dispute has some cost so that disputers are disincentivized from
    // wrongly disputing sponsors.
    uint public constant MIN_DISPUTE_BOND_PCT = 0;

    event CreatedExpiringMultiParty(address expiringMultiPartyAddress, address partyMemberAddress);

    constructor(bool _isTest, address _finderAddress, address _collateralTokenWhitelist)
        public
        ContractCreator(_finderAddress)
        Testable(_isTest)
    {
        collateralTokenWhitelist = AddressWhitelist(_collateralTokenWhitelist);
    }

    /**
     * @notice Creates an instance of expiring multi party and registers it within the registry.
     * @dev caller is automatically registered as the first (and only) party member.
     * @param params is a `ConstructorParams` object from ExpiringMultiParty
     */
    function createExpiringMultiParty(Params memory params) public returns (address) {
        ExpiringMultiParty derivative = new ExpiringMultiParty(_convertParams(params));

        address[] memory parties = new address[](1);
        parties[0] = msg.sender;

        _registerContract(parties, address(derivative));

        emit CreatedExpiringMultiParty(address(derivative), msg.sender);

        return address(derivative);
    }

    // Converts createExpiringMultiParty params to ExpiringMultiParty constructor params.
    function _convertParams(Params memory params)
        private
        view
        returns (ExpiringMultiParty.ConstructorParams memory constructorParams)
    {
        // Known from creator deployment.
        constructorParams.isTest = isTest;
        constructorParams.finderAddress = finderAddress;

        // Enforce configuration constrainments
        // @dev: Technically there is nothing in the ExpiringMultiParty contract
        // requiring these constraints. However, because "createExpiringMultiParty()"
        // is intended to be the only way to create valid financial contracts that are **registered** with the DVM (via "_registerContract()"),
        // we can enforce deployment configurations here.
        require(params.expirationTimestamp <= LATEST_EXPIRATION_TIMESTAMP);
        require(params.disputeBondPct.isGreaterThan(MIN_DISPUTE_BOND_PCT));
        require(bytes(params.syntheticName).length != 0);
        require(bytes(params.syntheticSymbol).length != 0);
        constructorParams.withdrawalLiveness = STRICT_WITHDRAWAL_LIVENESS;
        constructorParams.liquidationLiveness = STRICT_LIQUIDATION_LIVENESS;
        require(collateralTokenWhitelist.isOnWhitelist(params.collateralAddress));

        // Input from function call
        constructorParams.expirationTimestamp = params.expirationTimestamp;
        constructorParams.collateralAddress = params.collateralAddress;
        constructorParams.tokenFactoryAddress = params.tokenFactoryAddress;
        constructorParams.priceFeedIdentifier = params.priceFeedIdentifier;
        constructorParams.syntheticName = params.syntheticName;
        constructorParams.syntheticSymbol = params.syntheticSymbol;
        constructorParams.collateralRequirement = params.collateralRequirement;
        constructorParams.disputeBondPct = params.disputeBondPct;
        constructorParams.sponsorDisputeRewardPct = params.sponsorDisputeRewardPct;
        constructorParams.disputerDisputeRewardPct = params.disputerDisputeRewardPct;
    }
}
