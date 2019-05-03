pragma solidity ^0.5.0;

import "./MultiRole.sol";


/**
 * @dev Provides addresses of the live contracts implementing certain interfaces. Examples are the Oracle or Store
 * interfaces.
 */
contract Finder is MultiRole {

    enum Roles {
        // Can set the writer.
        Governance,
        // Can update/write the addresses which implement a given interface.
        Writer
    }

    mapping(string => address) public interfacesImplemented;

    constructor() public {
        _createExclusiveRole(uint(Roles.Governance), uint(Roles.Governance), msg.sender);
        _createExclusiveRole(uint(Roles.Writer), uint(Roles.Governance), msg.sender);
    }

    /**
     * @dev Updates the address of the contract that implements `interfaceName`.
     */
    function changeImplementationAddress(string calldata interfaceName, address implementationAddress)
        external
        onlyRoleHolder(uint(Roles.Writer))
    {
        interfacesImplemented[interfaceName] = implementationAddress;
    }
    
    /**
     * @dev Gets the address of the contract that implements the given `interfaceName`.
     */
    function getImplementationAddress(string calldata interfaceName)
        external
        view
        returns (address implementationAddress)
    {
        implementationAddress = interfacesImplemented[interfaceName];
        require(implementationAddress != address(0x0), "No implementation for interface found");
    }
}
