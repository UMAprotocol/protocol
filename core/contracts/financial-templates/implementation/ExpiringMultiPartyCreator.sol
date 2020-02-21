pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "../AddressWhitelist.sol";
import "../ContractCreator.sol";
import "../Testable.sol";
import "./ExpiringMultiParty.sol";

contract TokenizedDerivativeCreator is ContractCreator, Testable {
    constructor(
        address _finderAddress,
        address _returnCalculatorWhitelist,
        address _marginCurrencyWhitelist,
        bool _isTest
    ) public ContractCreator(_finderAddress) Testable(_isTest) {}

    event CreatedExpiringMultiParty(address contractAddress);

    function createExpiringMultiParty(ExpiringMultiParty.ConstructorParams memory params) public returns (address) {
        ExpiringMultiParty derivative = new ExpiringMultiParty(params);

        address[] memory parties = new address[](1);
        parties[0] = msg.sender;

        _registerContract(parties, address(derivative));

        emit CreatedExpiringMultiParty(address(derivative));

        return address(derivative);
    }
}
