pragma solidity >=0.4.24;

import "./Registry.sol";


contract ContractCreator {
    Registry internal registry;
    address internal oracleAddress;

    constructor(address registryAddress, address _oracleAddress) public {
        registry = Registry(registryAddress);
        oracleAddress = _oracleAddress;
    }

    function _registerNewContract(address firstParty, address secondParty, address contractToRegister) internal {
        registry.registerContract(firstParty, secondParty, contractToRegister);
    }
}