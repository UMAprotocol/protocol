pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../../oracle/implementation/ContractCreator.sol";
import "../../common/implementation/Testable.sol";
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
        uint siphonDelay;
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
    // - Synthetic name and symbol cannot be the null string: "".
    string internal constant STRING_NULL = "";

    constructor(bool _isTest, address _finderAddress) public ContractCreator(_finderAddress) Testable(_isTest) {}

    event CreatedExpiringMultiParty(address expiringMultiPartyAddress, address partyMemberAddress);

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
        require(params.expirationTimestamp <= LATEST_EXPIRATION_TIMESTAMP);
        require(params.disputeBondPct.isGreaterThan(MIN_DISPUTE_BOND_PCT));
        require(!_stringsEqual(params.syntheticName, STRING_NULL));
        require(!_stringsEqual(params.syntheticSymbol, STRING_NULL));
        constructorParams.withdrawalLiveness = STRICT_WITHDRAWAL_LIVENESS;
        constructorParams.liquidationLiveness = STRICT_LIQUIDATION_LIVENESS;

        // Input from function call
        constructorParams.expirationTimestamp = params.expirationTimestamp;
        constructorParams.siphonDelay = params.siphonDelay;
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

    /**
     * @notice Compares two strings. Taken from the StringUtils contract in the Ethereum Dapp-bin
     * (https://github.com/ethereum/dapp-bin/blob/master/library/stringUtils.sol).
     * @param a The first string.
     * @param b The first string.
     * @return result 'true' if the strings are equal, otherwise 'false'.
     */
    function _stringsEqual(string memory a, string memory b) internal pure returns (bool result) {
        bytes memory ba = bytes(a);
        bytes memory bb = bytes(b);

        if (ba.length != bb.length) return false;
        for (uint i = 0; i < ba.length; i++) {
            if (ba[i] != bb[i]) return false;
        }
        return true;
    }
}
