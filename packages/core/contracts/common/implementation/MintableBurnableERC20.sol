// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "../interfaces/MintableBurnableIERC20.sol";

/**
 * @title An ERC20 with permissioned burning and minting. The contract deployer will initially
 * be the owner who is capable of adding new roles.
 */
contract MintableBurnableERC20 is ERC20, MintableBurnableIERC20, AccessControl {
    /****************************************
     *  COSTANTS  *
     ****************************************/

    bytes32 public constant MINTER_ROLE = keccak256("Minter");

    bytes32 public constant BURNER_ROLE = keccak256("Burner");

    /****************************************
     *               MODIFIERS              *
     ****************************************/

    modifier onlyMinter() {
        require(hasRole(MINTER_ROLE, msg.sender), "Sender must be the minter");
        _;
    }

    modifier onlyBurner() {
        require(hasRole(BURNER_ROLE, msg.sender), "Sender must be the burner");
        _;
    }

    /**
     * @notice Constructs the ExpandedERC20.
     * @param _tokenName The name which describes the new token.
     * @param _tokenSymbol The ticker abbreviation of the name. Ideally < 5 chars.
     * @param _tokenDecimals The number of decimals to define token precision.
     */
    constructor(
        string memory _tokenName,
        string memory _tokenSymbol,
        uint8 _tokenDecimals
    ) public ERC20(_tokenName, _tokenSymbol) {
        _setupDecimals(_tokenDecimals);
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(MINTER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(BURNER_ROLE, DEFAULT_ADMIN_ROLE);
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @dev Mints `value` tokens to `recipient`, returning true on success.
     * @param recipient address to mint to.
     * @param value amount of tokens to mint.
     * @return True if the mint succeeded, or False.
     */
    function mint(address recipient, uint256 value) external override onlyMinter() returns (bool) {
        _mint(recipient, value);
        return true;
    }

    /**
     * @dev Burns `value` tokens owned by `msg.sender`.
     * @param value amount of tokens to burn.
     */
    function burn(uint256 value) external override onlyBurner() {
        _burn(msg.sender, value);
    }

    /**
     * @notice Add Minter role to account.
     * @dev The caller must have the Owner role.
     * @param account The address to which the Minter role is added.
     */
    function addMinter(address account) external virtual override {
        grantRole(MINTER_ROLE, account);
    }

    /**
     * @notice Add Burner role to account.
     * @dev The caller must have the Owner role.
     * @param account The address to which the Burner role is added.
     */
    function addBurner(address account) external virtual override {
        grantRole(BURNER_ROLE, account);
    }

    /**
     * @notice Add Admin role to account.
     * @dev The caller must have the Admin role.
     * @param account The address to which the Admin role is added.
     */
    function addAdmin(address account) external virtual override {
        grantRole(DEFAULT_ADMIN_ROLE, account);
    }

    /**
     * @notice Add Admin, Minter and Burner roles to account.
     * @dev The caller must have the Admin role.
     * @param account The address to which the Admin, Minter and Burner roles are added.
     */
    function addAdminAndMinterAndBurner(address account) external virtual override {
        grantRole(DEFAULT_ADMIN_ROLE, account);
        grantRole(MINTER_ROLE, account);
        grantRole(BURNER_ROLE, account);
    }

    /**
     * @notice Minter renounce to MINTER_ROLE
     */
    function renounceMinter() external virtual override {
        renounceRole(MINTER_ROLE, msg.sender);
    }

    /**
     * @notice Minter renounce to BURNER_ROLE
     */
    function renounceBurner() external virtual override {
        renounceRole(BURNER_ROLE, msg.sender);
    }

    /**
     * @notice Admin renounce to DEFAULT_ADMIN_ROLE
     */
    function renounceAdmin() external virtual override {
        renounceRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Admin, Minter and Burner renounce to DEFAULT_ADMIN_ROLE, MINTER_ROLE and BURNER_ROLE
     */
    function renounceAdminAndMinterAndBurner() external virtual override {
        renounceRole(DEFAULT_ADMIN_ROLE, msg.sender);
        renounceRole(MINTER_ROLE, msg.sender);
        renounceRole(BURNER_ROLE, msg.sender);
    }
}
