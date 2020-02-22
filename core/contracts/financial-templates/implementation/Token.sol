pragma solidity ^0.5.0;
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

import "../interfaces/TokenInterface.sol";
import "../../common/MultiRole.sol";

/**
 * @notice A burnable and mintable ERC20. There can only be one minter at a time
 * and the contract deployer will be the only initial minter.
 */
contract Token is TokenInterface, ERC20Detailed, ERC20Burnable, MultiRole {
    enum Roles {
        // Can set roles.
        Owner,
        // Addresses that can mint new tokens.
        Minter
    }

    constructor(string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals)
        public
        ERC20Detailed(tokenName, tokenSymbol, tokenDecimals)
        ERC20Burnable()
    {
        _createExclusiveRole(uint(Roles.Minter), uint(Roles.Minter), msg.sender);
    }

    /**
     * @dev Mints `value` tokens to `recipient`, returning true on success.
     */
    function mint(address recipient, uint value) external onlyRoleHolder(uint(Roles.Minter)) returns (bool) {
        _mint(recipient, value);
        return true;
    }

    /** 
     * @dev Reset minter role to new account
     *
     * Requirements
     *
     * - caller must be the current minter.
     */
    function resetMinter(address account) external {
        resetMember(uint(Roles.Minter), account);
    }

    function isMinter(address account) public view returns (bool) {
        return holdsRole(uint(Roles.Minter), account);
    }
}
