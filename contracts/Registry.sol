pragma solidity ^0.4.24;

import "./Derivative.sol";


contract Registry {
    mapping(address => address[]) private _registeredContracts;

    function createDerivative(
        address _counterpartyAddress,
        address _oracleAddress,
        int256 _defaultPenalty,
        int256 _requiredMargin,
        uint expiry,
        string product,
        uint size) external payable returns (address derivativeAddress) {

        DerivativeZeroNPV derivative = (new DerivativeZeroNPV).value(msg.value)(
            msg.sender,
            _counterpartyAddress,
            _oracleAddress,
            _defaultPenalty,
            _requiredMargin,
            expiry,
            product,
            size
        );

        register(msg.sender, address(derivative));
        register(_counterpartyAddress, address(derivative));

        return address(derivative);
    }

    function getNumRegisteredContracts() external view returns (uint number) {
        return getNumRegisteredContracts(msg.sender);
    }

    function getRegisteredContract(uint index) external view returns (address contractAddress) {
        return getRegisteredContract(index, msg.sender);
    }

    function register(address originator, address contractToRegister) public {
        _registeredContracts[originator].push(contractToRegister);
    }

    function getNumRegisteredContracts(address originator) public view returns (uint number) {
        return _registeredContracts[originator].length;
    }

    function getRegisteredContract(uint index, address originator) public view returns (address contractAddress) {
        return _registeredContracts[originator][index];
    }
}