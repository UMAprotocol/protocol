pragma solidity ^0.6.0;
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "../../common/implementation/ExpandedERC20.sol";


/**
 * @title Burnable and mintable ERC20.
 * @dev The contract deployer will initially be the only minter and burner as well as the owner  who
 * is capable of adding new roles. The contract deployer will also be the only initial minter of the contract.
 */

contract SyntheticToken is ExpandedERC20, ERC20Detailed {
    /**
     * @notice Constructs the SyntheticToken
     * @param tokenName used to describe the new token.
     * @param tokenSymbol short ticker abbreviation of the name. Ideally < 5 chars.
     * @param tokenDecimals used to delimitate the new token.
     */
    constructor(string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals)
        public
        ERC20Detailed(tokenName, tokenSymbol, tokenDecimals)
    {}

    /**
     * @notice Add minter role to account.
     * @dev the caller must have the Owner role.
     * @param account to be added to the minter roll.
     */
    function addMinter(address account) external {
        addMember(uint(Roles.Minter), account);
    }

    /**
     * @notice Remove minter role from account.
     * @dev the caller must have the Owner role.
     * @param account to be removed from the miner roll.
     */
    function removeMinter(address account) external {
        removeMember(uint(Roles.Minter), account);
    }

    /**
     * @notice Add burner role to account
     * @dev the caller must have the Owner role.
     * @param account to be added as a burner roll.
     */
    function addBurner(address account) external {
        addMember(uint(Roles.Burner), account);
    }

    /**
     * @notice Removes burner role from account.
     * @dev the caller must have the Owner role.
     * @param account to be removed from the burner roll.
     */
    function removeBurner(address account) external {
        removeMember(uint(Roles.Burner), account);
    }

        /**
     * @notice Reset Owner role to account
     * @dev the caller must have the Owner role.
     * @param account have it's rolls reset.
     */
    function resetOwner(address account) external {
        resetMember(uint(Roles.Owner), account);
    }

    function isMinter(address account) public view returns (bool) {
        return holdsRole(uint(Roles.Minter), account);
    }

    function isBurner(address account) public view returns (bool) {
        return holdsRole(uint(Roles.Burner), account);
    }
}
