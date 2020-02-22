pragma solidity ^0.5.0;
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../interfaces/TokenInterface.sol";
import "../../common/MultiRole.sol";

/**
 * @notice A burnable and mintable ERC20. The contract deployer will initially 
 * be the only minter and burner as well as the owner who is capable of adding new roles.
 */
contract Token is TokenInterface, ERC20Detailed, ERC20, MultiRole {
    enum Roles {
        // Can set roles.
        Owner,
        // Addresses that can mint new tokens.
        Minter,
        // Addresses that can burn tokens that address owns.
        Burner
    }

    constructor(string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals)
        public
        ERC20Detailed(tokenName, tokenSymbol, tokenDecimals)
    {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        address[] memory initialRoleHolders = new address[](1);
        initialRoleHolders[0] = msg.sender;
        _createSharedRole(uint(Roles.Minter), uint(Roles.Owner), initialRoleHolders);
        _createSharedRole(uint(Roles.Burner), uint(Roles.Owner), initialRoleHolders);
    }

    function mint(address recipient, uint value) external onlyRoleHolder(uint(Roles.Minter)) returns (bool) {
        _mint(recipient, value);
        return true;
    }

    function addMinter(address account) external {
        addMember(uint(Roles.Minter), account);
    }

    function removeMinter(address account) external {
        removeMember(uint(Roles.Minter), account);
    }

    function isMinter(address account) public view returns (bool) {
        return holdsRole(uint(Roles.Minter), account);
    }

    function burn(uint256 amount) external onlyRoleHolder(uint(Roles.Burner)) {
        _burn(msg.sender, amount);
    }

    function addBurner(address account) external {
        addMember(uint(Roles.Burner), account);
    }

    function removeBurner(address account) external {
        removeMember(uint(Roles.Burner), account);
    }

    function isBurner(address account) public view returns (bool) {
        return holdsRole(uint(Roles.Burner), account);
    }

    function resetOwner(address account) external {
        resetMember(uint(Roles.Owner), account);
    }
}
