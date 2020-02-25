pragma solidity ^0.5.0;
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "../../common/implementation/ExpandedERC20.sol";


/**
 * @notice A burnable and mintable ERC20. The contract deployer will initially 
 * be the only minter and burner as well as the owner who is capable of adding new roles. 
 * The contract deployer will also be the only initial minter of the contract.
 */
contract SyntheticToken is ExpandedERC20, ERC20Detailed {
    constructor(string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals)
        public
        ERC20Detailed(tokenName, tokenSymbol, tokenDecimals) {}

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
