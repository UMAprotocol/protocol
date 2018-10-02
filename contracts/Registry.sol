pragma solidity ^0.4.24;

import "./Derivative.sol";


contract Registry {
    mapping(address => address[]) private _registeredContracts;

    event Register(address indexed originator, address indexed derivative);

    function createDerivative(
        address counterpartyAddress,
        address oracleAddress,
        int256 defaultPenalty,
        int256 requiredMargin,
        uint expiry,
        string product,
        uint size) external payable returns (address derivativeAddress) {

        DerivativeZeroNPV derivative = (new DerivativeZeroNPV).value(msg.value)(
            msg.sender,
            counterpartyAddress,
            oracleAddress,
            defaultPenalty,
            requiredMargin,
            expiry,
            product,
            size
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
        return _registeredContracts[originator].length;
    }

    function getRegisteredContract(uint index, address originator) public view returns (address contractAddress) {
        return _registeredContracts[originator][index];
    }

    function _register(address originator, address contractToRegister) internal {
        _registeredContracts[originator].push(contractToRegister);
        emit Register(originator, contractToRegister);
    }
}