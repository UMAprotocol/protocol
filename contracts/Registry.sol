pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";


contract Registry is Ownable {
    mapping(address => address[]) private registeredContracts;
    mapping(address => bool) private contractCreators;


    struct RegisteredDerivative {
        address creator;
        address derivative;
    };

    RegisteredDerivative[] registeredDerivatives;

    event Register(address indexed party, address indexed derivative);


    // v1 required methods below:
    function isDerivativeRegistered(address derivative) external view returns (bool isRegistred) {

    }

    function getRegisteredDerivatives(address party) external view returns (Derivative[] memory derivatives) {

    }

    function getAllRegisteredDerivatives() external view returns (Derivative[] memory derivatives) {

    }

    function isDerivativeCreatorAuthorized(address derivativeCreator) external view returns (bool isAuthorized) {

    }

    function registerDerivative(address[] calldata counterparties, address derivativeAddress) external {

    }

    function addContractCreator(address contractCreator) external onlyOwner {
        contractCreators[contractCreator] = true;
    }

    function removeContractCreator(address contractCreator) external onlyOwner {
        contractCreators[contractCreator] = false;
    }



    // Old methods



    function registerContract(address party, address contractToRegister) external {
        require(contractCreators[msg.sender]);
        _register(party, contractToRegister);
    }

    function getNumRegisteredContractsBySender() external view returns (uint number) {
        return getNumRegisteredContracts(msg.sender);
    }

    function getRegisteredContractBySender(uint index) external view returns (address contractAddress) {
        return getRegisteredContract(index, msg.sender);
    }

    function getNumRegisteredContracts(address party) public view returns (uint number) {
        return registeredContracts[party].length;
    }

    function getRegisteredContract(uint index, address party) public view returns (address contractAddress) {
        return registeredContracts[party][index];
    }

    function _register(address party, address contractToRegister) internal {
        registeredContracts[party].push(contractToRegister);
        emit Register(party, contractToRegister);
    }
}
