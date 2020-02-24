pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "../../tokenized-derivative/AddressWhitelist.sol";
import "../../tokenized-derivative/ContractCreator.sol";
import "../../common/Testable.sol";
import "./ExpiringMultiParty.sol";

/**
@title Expiring Multi Party Contract creator
@notice Factory contract to create and register new instances of expiring multiparty contracts
*/
contract ExpiringMultiPartyCreator is ContractCreator, Testable {
    struct Params {
        uint expirationTimestamp;
        uint withdrawalLiveness;
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

    constructor(bool _isTest, address _finderAddress) public ContractCreator(_finderAddress) Testable(_isTest) {}

    event CreatedExpiringMultiParty(address expiringMultiPartyAddress, address partyMemberAddress);

    /**
     * @notice Creates an instance of expiring multi party and registers it within the finder
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

        // Input from function call
        constructorParams.expirationTimestamp = params.expirationTimestamp;
        constructorParams.withdrawalLiveness = params.withdrawalLiveness;
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
