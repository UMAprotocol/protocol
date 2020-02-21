pragma solidity ^0.5.0;

// Sourced from proposed OpenZeppelin implementation of ERC20Mintable with v3 contracts
// - description: https://forum.openzeppelin.com/t/redesigning-access-control-for-the-openzeppelin-contracts/2177/24
// - source code: https://gist.github.com/nventuro/ac42bd936f678ebf55c4c0c4a4ee4c72

interface IAccessControl {
    // Queries

    // Returns true if an account has a role
    function hasRole(bytes32 roleId, address account) external view returns (bool);

    // Returns the number of accounts with a role
    function getRoleMembersCount(bytes32 roleId) external view returns (uint256);

    // Returns an account with a role at index
    function getRoleMember(bytes32 roleId, uint256 index) external view returns (address);

    // Returns a role's admin role
    function getRoleAdmin(bytes32 roleId) external view returns (address);

    // Operations

    // Gives a role to an account. Caller must have its admin role
    function grantRole(bytes32 roleId, address account) external;

    // Revokes a role from an account. Caller must have its admin role
    function revokeRole(bytes32 roleId, address account) external;

    // Renounces a role. Caller must be `account`
    function renounceRole(bytes32 roleId, address account) external;
}
