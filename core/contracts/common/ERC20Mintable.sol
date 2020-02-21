pragma solidity ^0.5.0;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./AccessControl.sol";

/**
 * @dev Extension of {ERC20} that adds a set of accounts
 * which have permission to mint (create) new tokens as they see fit.
 *
 * At construction, the deployer of the contract is the only admin capable of adding new minters and is initially the only minter.
 */
contract ERC20Mintable is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    event MinterAdded(address indexed account);
    event MinterRemoved(address indexed account);

    modifier onlyMinter() {
        require(isMinter(_msgSender()), "MinterRole: caller does not have the Minter role");
        _;
    }
    modifier onlyMinterAdmin() {
        require(isMinterAdmin(_msgSender()), "MinterRole: caller is not the admin of the Minter role");
        _;
    }

    constructor () internal {
        _setRoleAdmin(MINTER_ROLE, _msgSender());
        _addMinter(_msgSender());
    }

     /** @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * Requirements
     *
     * - `to` cannot be the zero address.
     * - the caller must have the MINTER_ROLE.
     */
    function mint(address recipient, uint256 amount) external onlyMinter returns (bool) {
        _mint(recipient, amount);
        return true;
    }

    /** @dev Grant minter the ability to create new tokens
     *
     * Requirements
     *
     * - caller must be the admin of the MINTER_ROLE.
     */
    function addMinter(address account) external onlyMinterAdmin {
        _addMinter(account);
    }

     /** @dev Change the minter admin
     *
     * Requirements
     *
     * - caller must be the admin of the MINTER_ROLE.
     */
    function setMinterAdmin(address account) external onlyMinterAdmin {
        _setRoleAdmin(MINTER_ROLE, account);
    }

    /** @dev Renounce minter role
     *
     * Requirements
     *
     * - caller must have the MINTER_ROLE.
     */
    function renounceMinter() external {
        renounceRole(MINTER_ROLE, _msgSender());
    }

    function isMinter(address account) public view returns (bool) {
        return hasRole(MINTER_ROLE, account);
    }

    function getMinterCount() public view returns (uint256) {
        return getRoleMembersCount(MINTER_ROLE);
    }

    function isMinterAdmin(address account) public view returns (bool) {
        return (getRoleAdmin(MINTER_ROLE) == account);
    }

    function _addMinter(address account) internal {
        _grantRole(MINTER_ROLE, account);
        emit MinterAdded(account);
    }
}