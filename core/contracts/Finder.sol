pragma solidity ^0.5.0;

import "@openzeppelin/contracts/ownership/Ownable.sol";

/**
 * @title Provides addresses of the live contracts implementing certain interfaces. 
 * @dev Examples are the Oracle or Store interfaces.
 */
contract Finder is Ownable {
    mapping(bytes32 => address) public interfacesImplemented;

    event InterfaceImplementationChanged(bytes32 indexed interfaceName, address indexed newImplementationAddress);

    /**
     * @dev Updates the address of the contract that implements `interfaceName`.
     */
    function changeImplementationAddress(bytes32 interfaceName, address implementationAddress) external onlyOwner {
        interfacesImplemented[interfaceName] = implementationAddress;
        emit InterfaceImplementationChanged(interfaceName, implementationAddress);
    }

    /**
     * @dev Gets the address of the contract that implements the given `interfaceName`.
     */
    function getImplementationAddress(bytes32 interfaceName) external view returns (address implementationAddress) {
        implementationAddress = interfacesImplemented[interfaceName];
        require(implementationAddress != address(0x0), "No implementation for interface found");
    }
}
