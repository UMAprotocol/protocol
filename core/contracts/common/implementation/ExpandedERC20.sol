pragma solidity ^0.5.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./MultiRole.sol";
import "../interfaces/ExpandedIERC20.sol";


/**
 * @title An ERC20 with permissioned burning and minting. The contract deployer will initially 
 * be the owner who is capable of adding new roles. 
 */
contract ExpandedERC20 is ExpandedIERC20, ERC20, MultiRole {
    enum Roles {
        // Can set the minter and burner.
        Owner,
        // Addresses that can mint new tokens.
        Minter,
        // Addresses that can burn tokens that address owns.
        Burner
    }

    constructor() public {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        _createSharedRole(uint(Roles.Minter), uint(Roles.Owner), new address[](0));
        _createSharedRole(uint(Roles.Burner), uint(Roles.Owner), new address[](0));
    }

    /**
     * @dev Mints `value` tokens to `recipient`, returning true on success.
     */
    function mint(address recipient, uint value) external onlyRoleHolder(uint(Roles.Minter)) returns (bool) {
        _mint(recipient, value);
        return true;
    }

    /**
     * @dev Burns `value` tokens owned by `msg.sender`.
     */
    function burn(uint value) external onlyRoleHolder(uint(Roles.Burner)) {
        _burn(msg.sender, value);
    }
}
