/**
 * Withdrawable contract.
 */

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "./MultiRole.sol";


/**
 * @title Base contract that allows a specific role to withdraw any ETH and/or ERC20 tokens that the contract holds.
 */
abstract contract Withdrawable is MultiRole {
    using SafeERC20 for IERC20;

    uint private _roleId;

    /**
     * @notice Withdraws ETH from the contract.
     */
    function withdraw(uint amount) external onlyRoleHolder(_roleId) {
        Address.sendValue(msg.sender, amount);
    }

    /**
     * @notice Withdraws ERC20 tokens from the contract.
     */
    function withdrawErc20(address erc20Address, uint amount) external onlyRoleHolder(_roleId) {
        IERC20 erc20 = IERC20(erc20Address);
        erc20.safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Internal method that allows derived contracts to create a role for withdrawal.
     * @dev Either this method or `setWithdrawRole` must be called by the derived class for this contract to function
     * properly.
     */
    function createWithdrawRole(uint roleId, uint managingRoleId, address owner) internal {
        _roleId = roleId;
        _createExclusiveRole(roleId, managingRoleId, owner);
    }

    /**
     * @notice Internal method that allows derived contracts to choose the role for withdrawal.
     * @dev The role `roleId` must exist. Either this method or `createWithdrawRole` must be
     * called by the derived class for this contract to function properly.
     */
    function setWithdrawRole(uint roleId) internal onlyValidRole(roleId) {
        _roleId = roleId;
    }
}
