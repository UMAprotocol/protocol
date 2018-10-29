pragma solidity ^0.4.24;

import "./Derivative.sol";


contract Registry {
    mapping(address => address[]) private registeredContracts;
    address private oracleAddress;

    event Register(address indexed originator, address indexed derivative);

    constructor(address _oracleAddress) public {
        oracleAddress = _oracleAddress;
    }

    function createDerivative(
        address counterpartyAddress,
        int256 defaultPenalty,
        int256 requiredMargin,
        uint expiry,
        string product,
        uint notional) external payable returns (address derivativeAddress) {

        // TODO: Think about which person is going to be creating the contract... Right now, we're assuming it comes
        //       from the taker. This is just for convenience
        SimpleDerivative derivative = (new SimpleDerivative).value(msg.value)(
            counterpartyAddress,
            msg.sender,
            oracleAddress,
            defaultPenalty,
            requiredMargin,
            expiry,
            product,
            notional
        );

        _register(msg.sender, address(derivative));
        _register(counterpartyAddress, address(derivative));

        return address(derivative);
    }

    function getNumRegisteredContractsBySender() external view returns (uint number) {
        return getNumRegisteredContracts(msg.sender);
    }

    function getRegisteredContractBySender(uint index) external view returns (address contractAddress) {
        return getRegisteredContract(index, msg.sender);
    }

    function getNumRegisteredContracts(address originator) public view returns (uint number) {
        return registeredContracts[originator].length;
    }

    function getRegisteredContract(uint index, address originator) public view returns (address contractAddress) {
        return registeredContracts[originator][index];
    }

    function _register(address originator, address contractToRegister) internal {
        registeredContracts[originator].push(contractToRegister);
        emit Register(originator, contractToRegister);
    }
}
