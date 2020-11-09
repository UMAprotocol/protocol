pragma solidity ^0.6.0;
import "../../common/implementation/JarvisExpandedERC20.sol";
import "../../common/implementation/Lockable.sol";


/**
 * @title Burnable and mintable ERC20.
 * @dev The contract deployer will initially be the only minter, burner and owner capable of adding new roles.
 */

contract JarvisSyntheticToken is JarvisExpandedERC20, Lockable {
    /**
     * @notice Constructs the SyntheticToken.
     * @param tokenName The name which describes the new token.
     * @param tokenSymbol The ticker abbreviation of the name. Ideally < 5 chars.
     * @param tokenDecimals The number of decimals to define token precision.
     */
    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        uint8 tokenDecimals
    ) public JarvisExpandedERC20(tokenName, tokenSymbol, tokenDecimals) nonReentrant() {}

    /**
     * @notice Add Minter role to account.
     * @dev The caller must have the Owner role.
     * @param account The address to which the Minter role is added.
     */
    function addMinter(address account) external override nonReentrant() {
        grantRole(MINTER_ROLE, account);
    }

    /**
     * @notice Add Burner role to account.
     * @dev The caller must have the Owner role.
     * @param account The address to which the Burner role is added.
     */
    function addBurner(address account) external override nonReentrant() {
        grantRole(BURNER_ROLE, account);
    }

    /**
     * @notice Add Admin role to account.
     * @dev The caller must have the Admin role.
     * @param account The address to which the Admin role is added.
     */
    function addAdmin(address account) external override nonReentrant() {
        grantRole(DEFAULT_ADMIN_ROLE, account);
    }

    /**
     * @notice Minter renounce to MINTER_ROLE
     */
    function renounceMinter() external override nonReentrant() {
        renounceRole(MINTER_ROLE, msg.sender);
    }

    /**
     * @notice Minter renounce to BURNER_ROLE
     */
    function renounceBurner() external override nonReentrant() {
        renounceRole(BURNER_ROLE, msg.sender);
    }

    /**
     * @notice Admin renounce to DEFAULT_ADMIN_ROLE
     */
    function renounceAdmin() external override nonReentrant() {
        renounceRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Add Admin, Minter and Burner roles to account.
     * @dev The caller must have the Admin role.
     * @param account The address to which the Admin, Minter and Burner roles are added.
     */
    function addAdminAndMinterAndBurner(address account) external override nonReentrant() {
        grantRole(DEFAULT_ADMIN_ROLE, account);
        grantRole(MINTER_ROLE, account);
        grantRole(BURNER_ROLE, account);
    }

    /**
     * @notice Admin, Minter and Burner renounce to DEFAULT_ADMIN_ROLE, MINTER_ROLE and BURNER_ROLE
     */
    function renounceAdminAndMinterAndBurner() external override nonReentrant() {
        renounceRole(DEFAULT_ADMIN_ROLE, msg.sender);
        renounceRole(MINTER_ROLE, msg.sender);
        renounceRole(BURNER_ROLE, msg.sender);
    }

    /**
     * @notice Checks if a given account holds the Minter role.
     * @param account The address which is checked for the Minter role.
     * @return bool True if the provided account is a Minter.
     */
    function isMinter(address account) public view nonReentrantView() returns (bool) {
        return hasRole(MINTER_ROLE, account);
    }

    /**
     * @notice Checks if a given account holds the Burner role.
     * @param account The address which is checked for the Burner role.
     * @return bool True if the provided account is a Burner.
     */
    function isBurner(address account) public view nonReentrantView() returns (bool) {
        return hasRole(BURNER_ROLE, account);
    }
}
