pragma solidity ^0.5.0;

import "@openzeppelin/contracts/ownership/Ownable.sol";

import "../interfaces/FinderInterface.sol";

/**
 * @title Provides addresses of the live contracts implementing certain interfaces.
 * @dev Examples of interfaces with implementations that Finder locates are the Oracle and Store interfaces.
 */
contract Finder is FinderInterface, Ownable {
    mapping(bytes32 => address) public interfacesImplemented;

    event InterfaceImplementationChanged(bytes32 indexed interfaceName, address indexed newImplementationAddress);

    /**
     * @notice Updates the address of the contract that implements `interfaceName`.
     * @param interfaceName bytes32 of the interface name that is either changed or registered.
     * @param implementationAddress address of the interface's contract.
     */
    function changeImplementationAddress(bytes32 interfaceName, address implementationAddress) external onlyOwner {
        interfacesImplemented[interfaceName] = implementationAddress;

        emit InterfaceImplementationChanged(interfaceName, implementationAddress);
    }

    /**
     * @notice Gets the address of the contract that implements the given `interfaceName`.
     * @param interfaceName queried interface.
     * @return implementationAddress address of the defined interface.
     */
    function getImplementationAddress(bytes32 interfaceName) external view returns (address implementationAddress) {
        implementationAddress = interfacesImplemented[interfaceName];
        require(implementationAddress != address(0x0), "No implementation for interface found");
    }
}
