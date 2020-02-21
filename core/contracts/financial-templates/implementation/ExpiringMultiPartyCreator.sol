pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "../../tokenized-derivative/AddressWhitelist.sol";
import "../../tokenized-derivative/ContractCreator.sol";
import "../../common/Testable.sol";
import "./ExpiringMultiParty.sol";

contract ExpiringMultiPartyCreator is ContractCreator, Testable {
    constructor(bool _isTest, address _finderAddress) public ContractCreator(_finderAddress) Testable(_isTest) {}

    event CreatedExpiringMultiParty(address expiringMultiPartyAddress, address partyMemberAddress);

    function createExpiringMultiParty(ExpiringMultiParty.ConstructorParams memory params) public returns (address) {
        ExpiringMultiParty derivative = new ExpiringMultiParty(params);

        address[] memory parties = new address[](1);
        parties[0] = msg.sender;

        _registerContract(parties, address(derivative));

        emit CreatedExpiringMultiParty(address(derivative), msg.sender);

        return address(derivative);
    }
}
