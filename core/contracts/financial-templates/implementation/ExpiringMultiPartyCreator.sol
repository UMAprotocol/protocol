pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../../oracle/implementation/ContractCreator.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/AddressWhitelist.sol";
import "./ExpiringMultiParty.sol";


/**
@title Expiring Multi Party Contract creator
@notice Factory contract to create and register new instances of expiring multiparty contracts
*/
contract ExpiringMultiPartyCreator is ContractCreator, Testable {
    struct Params {
        uint expirationTimestamp;
        uint withdrawalLiveness;
        uint siphonDelay;
        address collateralAddress;
        address tokenFactoryAddress;
        bytes32 priceFeedIdentifier;
        string syntheticName;
        string syntheticSymbol;
        uint liquidationLiveness;
        FixedPoint.Unsigned collateralRequirement;
        FixedPoint.Unsigned disputeBondPct;
        FixedPoint.Unsigned sponsorDisputeRewardPct;
        FixedPoint.Unsigned disputerDisputeRewardPct;
    }

    AddressWhitelist public collateralTokenWhitelist;

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

        // @dev: Technically there is nothing in the ExpiringMultiParty contract
        // requiring the collateral token to be whitelisted. However, because "createExpiringMultiParty()"
        // is supposed to be the only way to create valid financial contracts that are **registered** with the DVM (via "_registerContract()"),
        // we can enforce whitelisting of collateral currencies here in practice.
        require(collateralTokenWhitelist.isOnWhitelist(params.collateralAddress));
        constructorParams.collateralAddress = params.collateralAddress;

        // Input from function call
        constructorParams.expirationTimestamp = params.expirationTimestamp;
        constructorParams.withdrawalLiveness = params.withdrawalLiveness;
        constructorParams.siphonDelay = params.siphonDelay;
        constructorParams.collateralAddress = params.collateralAddress;
        constructorParams.tokenFactoryAddress = params.tokenFactoryAddress;
        constructorParams.priceFeedIdentifier = params.priceFeedIdentifier;
        constructorParams.syntheticName = params.syntheticName;
        constructorParams.syntheticSymbol = params.syntheticSymbol;
        constructorParams.liquidationLiveness = params.liquidationLiveness;
        constructorParams.collateralRequirement = params.collateralRequirement;
        constructorParams.disputeBondPct = params.disputeBondPct;
        constructorParams.sponsorDisputeRewardPct = params.sponsorDisputeRewardPct;
        constructorParams.disputerDisputeRewardPct = params.disputerDisputeRewardPct;
    }
}
