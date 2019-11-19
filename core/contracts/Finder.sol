pragma solidity ^0.5.0;

import "./MultiRole.sol";


/**
 * @title Provides addresses of the live contracts implementing certain interfaces. 
 * @dev Examples are the Oracle or Store interfaces.
 */
contract Finder is MultiRole {

    enum Roles {
        // Can set the writer.
        Governance,
        // Can update/write the addresses which implement a given interface.
        Writer
    }

    mapping(bytes32 => address) public interfacesImplemented;

    event InterfaceImplementationChanged(bytes32 indexed interfaceName, address indexed newImplementationAddress);

    constructor() public {
        _createExclusiveRole(uint(Roles.Governance), uint(Roles.Governance), msg.sender);
        _createExclusiveRole(uint(Roles.Writer), uint(Roles.Governance), msg.sender);
    }

    /**
     * @dev Updates the address of the contract that implements `interfaceName`.
     */
    function changeImplementationAddress(bytes32 interfaceName, address implementationAddress)
        external
        onlyRoleHolder(uint(Roles.Writer))
    {
        interfacesImplemented[interfaceName] = implementationAddress;
        emit InterfaceImplementationChanged(interfaceName, implementationAddress);
    }
    
    /**
     * @dev Gets the address of the contract that implements the given `interfaceName`.
     */
    function getImplementationAddress(bytes32 interfaceName)
        external
        view
        returns (address implementationAddress)
    {
        implementationAddress = interfacesImplemented[interfaceName];
        require(implementationAddress != address(0x0), "No implementation for interface found");
    }
}
