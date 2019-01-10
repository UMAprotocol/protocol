pragma solidity ^0.5.0;

import "./Registry.sol";


contract ContractCreator {
    Registry internal registry;
    address internal oracleAddress;
    address internal v2OracleAddress;
    address internal priceFeedAddress;

    constructor(address registryAddress, address _oracleAddress,
                address _v2OracleAddress, address _priceFeedAddress) public {
        registry = Registry(registryAddress);
        oracleAddress = _oracleAddress;
        v2OracleAddress = _v2OracleAddress;
        priceFeedAddress = _priceFeedAddress;
    }

    function _registerNewContract(address firstParty, address secondParty, address contractToRegister) internal {
        registry.registerContract(firstParty, secondParty, contractToRegister);
    }
}
