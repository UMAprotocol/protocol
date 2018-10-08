pragma solidity ^0.4.24;

import "./Derivative.sol";


contract Registry {
    mapping(address => address[]) private registeredContracts;

    event Register(address indexed originator, address indexed derivative);

    function createDerivative(
        address counterpartyAddress,
        address oracleAddress,
        int256 defaultPenalty,
        int256 requiredMargin,
        uint expiry,
        string product,
        uint notional) external payable returns (address derivativeAddress) {

        SimpleDerivative derivative = (new SimpleDerivative).value(msg.value)(
            msg.sender,
            counterpartyAddress,
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