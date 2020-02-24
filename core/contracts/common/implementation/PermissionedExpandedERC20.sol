pragma solidity ^0.5.0;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/ExpandedIERC20.sol";
import "./MultiRole.sol";

/**
 * @title A burnable and mintable ERC20 with designated roles. The contract deployer will initially 
 * be the owner who is capable of adding new roles. Also, similar to openzeppelin's deprecated ERC20Mintable contract,
 * the deployer will be the only minter initially.
 */
contract PermissionedExpandedERC20 is ExpandedIERC20, ERC20, MultiRole {
    enum Roles {
        // Can set roles.
        Owner,
        // Addresses that can mint new tokens.
        Minter,
        // Addresses that can burn tokens that address owns.
        Burner
    }

    constructor() public
    {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        address[] memory initialMinters = new address[](1);
        initialMinters[0] = msg.sender;
        _createSharedRole(uint(Roles.Minter), uint(Roles.Owner), initialMinters);
        _createSharedRole(uint(Roles.Burner), uint(Roles.Owner), new address[](0));
    }

    function mint(address recipient, uint value) external onlyRoleHolder(uint(Roles.Minter)) returns (bool) {
        _mint(recipient, value);
        return true;
    }

    function burn(uint256 amount) external onlyRoleHolder(uint(Roles.Burner)) {
        _burn(msg.sender, amount);
    }

    /**
     * @dev Add minter role to account.
     *
     * Requirements:
     *
     * - the caller must have the Owner role.
     */
    function addMinter(address account) external {
        addMember(uint(Roles.Minter), account);
    }

    /**
     * @dev Remove minter role from account.
     *
     * Requirements:
     *
     * - the caller must have the Owner role.
     */
    function removeMinter(address account) external {
        removeMember(uint(Roles.Minter), account);
    }

    function isMinter(address account) public view returns (bool) {
        return holdsRole(uint(Roles.Minter), account);
    }

    /**
     * @dev Add burner role to account
     *
     * Requirements:
     *
     * - the caller must have the Owner role.
     */
    function addBurner(address account) external {
        addMember(uint(Roles.Burner), account);
    }

    /**
     * @dev Removes burner role from account.
     *
     * Requirements:
     *
     * - the caller must have the Owner role.
     */
    function removeBurner(address account) external {
        removeMember(uint(Roles.Burner), account);
    }

    function isBurner(address account) public view returns (bool) {
        return holdsRole(uint(Roles.Burner), account);
    }

    /**
     * @dev Reset Owner role to account
     *
     * Requirements:
     *
     * - the caller must have the Owner role.
     */
    function resetOwner(address account) external {
        resetMember(uint(Roles.Owner), account);
    }
}
