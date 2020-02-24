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
    constructor(bool _isTest, address _finderAddress) public ContractCreator(_finderAddress) Testable(_isTest) {}

    event CreatedExpiringMultiParty(address expiringMultiPartyAddress, address partyMemberAddress);

    /**
     * @notice Creates an instance of expiring multi party and registers it within the finder
     * @dev caller is automatically registered as the first (and only) party member.
     * @param params is a `ConstructorParams` object from ExpiringMultiParty
     */
    function createExpiringMultiParty(ExpiringMultiParty.ConstructorParams memory params) public returns (address) {
        ExpiringMultiParty derivative = new ExpiringMultiParty(params);

        address[] memory parties = new address[](1);
        parties[0] = msg.sender;

        _registerContract(parties, address(derivative));

        emit CreatedExpiringMultiParty(address(derivative), msg.sender);

        return address(derivative);
    }
}
