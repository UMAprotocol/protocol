/*
  MutliRoleTest contract.
*/

pragma solidity ^0.5.0;

import "../MultiRole.sol";

// The purpose of this contract is to make the MultiRole creation methods externally callable for testing purposes.
contract MultiRoleTest is MultiRole {
    function createSharedRole(uint roleId, uint managingRoleId, address[] calldata initialMembers)
        external
    {
        _createSharedRole(roleId, managingRoleId, initialMembers);
    }

    function createExclusiveRole(uint roleId, uint managingRoleId, address initialMember)
        external
    {
        _createExclusiveRole(roleId, managingRoleId, initialMember);
    }

    function revertIfNotHoldingRole(uint roleId) onlyRoleHolder(roleId) {}
}