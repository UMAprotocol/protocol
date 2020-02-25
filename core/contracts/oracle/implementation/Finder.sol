pragma solidity ^0.6.0;

import "@openzeppelin/contracts/ownership/Ownable.sol";

import "../interfaces/FinderInterface.sol";


/**
 * @title Implementation of the FinderInterface.
 */
contract Finder is FinderInterface, Ownable {
    mapping(bytes32 => address) public interfacesImplemented;

    event InterfaceImplementationChanged(bytes32 indexed interfaceName, address indexed newImplementationAddress);

    function changeImplementationAddress(bytes32 interfaceName, address implementationAddress) external override onlyOwner {
        interfacesImplemented[interfaceName] = implementationAddress;
        emit InterfaceImplementationChanged(interfaceName, implementationAddress);
    }

    function getImplementationAddress(bytes32 interfaceName) external override view returns (address implementationAddress) {
        implementationAddress = interfacesImplemented[interfaceName];
        require(implementationAddress != address(0x0), "No implementation for interface found");
    }
}
