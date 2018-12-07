pragma solidity >=0.4.24;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";


contract Registry is Ownable {
    mapping(address => address[]) private registeredContracts;
    mapping(address => bool) private contractCreators;

    event Register(address indexed party, address indexed derivative);

    function addContractCreator(address contractCreator) external onlyOwner {
        contractCreators[contractCreator] = true;
    }

    function removeContractCreator(address contractCreator) external onlyOwner {
        contractCreators[contractCreator] = false;
    }

    function registerContract(address firstParty, address secondParty, address contractToRegister) external {
        require(contractCreators[msg.sender]);
        _register(firstParty, contractToRegister);
        _register(secondParty, contractToRegister);
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
