pragma solidity ^0.5.0;

import "../interfaces/AccessControlInterface.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

// Sourced from proposed OpenZeppelin implementation of ERC20Mintable with v3 contracts
// - description: https://forum.openzeppelin.com/t/redesigning-access-control-for-the-openzeppelin-contracts/2177/24
// - source code: https://gist.github.com/nventuro/ac42bd936f678ebf55c4c0c4a4ee4c72

/** @dev Each role has an associated admin role, and a role can only be granted or revoked by accounts that have it’s admin role
 */
contract AccessControl is IAccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;

    struct Role {
        EnumerableSet.AddressSet members;
        address admin;        
    }

    mapping (bytes32 => Role) _roles;

    function hasRole(bytes32 roleId, address account)
        public view returns (bool)
    {
        return _roles[roleId].members.contains(account);
    }

    function getRoleAdmin(bytes32 roleId)
        public
        view
        returns (address)
    {
        return _roles[roleId].admin;
    }

    function getRoleMembersCount(bytes32 roleId)
        public
        view
        returns (uint256)
    {
        return _roles[roleId].members.length();
    }
    
    function getRoleMember(bytes32 roleId, uint256 index)
        external
        view
        returns (address)
    {
        return _roles[roleId].members.get(index);
    }

    function grantRole(bytes32 roleId, address account) public {
        require(_roles[roleId].admin == msg.sender,
            "AccessControl: sender must be the admin to grant"
        );

        _grantRole(roleId, account);
    }

    function revokeRole(bytes32 roleId, address account) public {
        require(_roles[roleId].admin == msg.sender,
            "AccessControl: sender must be the admin to revoke"
        );

        _revokeRole(roleId, account);
    }

    function renounceRole(bytes32 roleId, address account) public {
        require(account == msg.sender, 
            "AccessControl: can only renounce roles for self");
        
        require(hasRole(roleId, msg.sender),
            "AccessControl: sender have the role to revoke"
        );

        _revokeRole(roleId, account);
    }

    function _grantRole(bytes32 roleId, address account) internal {
        bool added = _roles[roleId].members.add(account);
        require(added, "AccessControl: account already has role");
    }

    function _revokeRole(bytes32 roleId, address account) internal {
        bool removed = _roles[roleId].members.remove(account);
        require(removed, "AccessControl: account does not have role");
    }

    function _setRoleAdmin(bytes32 roleId, address account) internal {
        _roles[roleId].admin = account;
    }
}