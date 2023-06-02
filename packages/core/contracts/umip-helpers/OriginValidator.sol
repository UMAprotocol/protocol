// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

/**
 * @title An auxiliary contract that checks if the tx origin is the upgrader.
 * @dev Note: the validate function can be used as the first transaction in a governance proposals to block any other
 * transactions from being executed if the proposal is not initiated by the upgrader.
 */
contract OriginValidator {
    /**
     * @notice Checks if the caller is the upgrader.
     * @dev This is used as the first transaction in the upgrade process to block any other transactions from being
     * executed if the upgrade is not initiated by the upgrader.
     */
    function validate(address upgrader) public view {
        require(tx.origin == upgrader);
    }
}
