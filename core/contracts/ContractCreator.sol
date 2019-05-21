pragma solidity ^0.5.0;

import "./Registry.sol";


contract ContractCreator is Withdrawable {
    Registry internal registry;
    address internal oracleAddress;
    address internal storeAddress;
    address internal priceFeedAddress;

    constructor(
        address registryAddress,
        address _oracleAddress,
        address _storeAddress,
        address _priceFeedAddress
    ) public {
        registry = Registry(registryAddress);
        oracleAddress = _oracleAddress;
        storeAddress = _storeAddress;
        priceFeedAddress = _priceFeedAddress;
    }

    function _registerContract(address[] memory parties, address contractToRegister) internal {
        registry.registerDerivative(parties, contractToRegister);
    }
}
