pragma solidity ^0.5.0;

import "./Registry.sol";


contract ContractCreator {
    Registry internal registry;
    address internal v2OracleAddress;
    address internal priceFeedAddress;

    constructor(address registryAddress, address _v2OracleAddress, address _priceFeedAddress) public {
        registry = Registry(registryAddress);
        v2OracleAddress = _v2OracleAddress;
        priceFeedAddress = _priceFeedAddress;
    }

    function _registerContract(address party, address contractToRegister) internal {
        registry.registerContract(party, contractToRegister);
    }
}
