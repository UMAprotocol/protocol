pragma solidity ^0.6.0;

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
     * @param implementationAddress address of the implementation contract.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function changeImplementationAddress(bytes32 interfaceName, address implementationAddress) external override onlyOwner {
        interfacesImplemented[interfaceName] = implementationAddress;

        emit InterfaceImplementationChanged(interfaceName, implementationAddress);
    }

    /**
     * @notice Gets the address of the contract that implements the given `interfaceName`.
     * @param interfaceName queried interface.
     * @return implementationAddress address of the defined interface.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function getImplementationAddress(bytes32 interfaceName) external override view returns (address implementationAddress) {
        implementationAddress = interfacesImplemented[interfaceName];
        require(implementationAddress != address(0x0), "No implementation for interface found");
    }
}
