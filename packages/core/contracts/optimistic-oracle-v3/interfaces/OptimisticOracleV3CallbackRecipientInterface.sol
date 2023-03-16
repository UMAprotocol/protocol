// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

/**
 * @title Optimistic Oracle V3 Callback Recipient Interface
 * @notice Interface for contracts implementing callbacks to be received from the Optimistic Oracle V3.
 */
interface OptimisticOracleV3CallbackRecipientInterface {
    /**
     * @notice Callback function that is called by Optimistic Oracle V3 when an assertion is resolved.
     * @param assertionId The identifier of the assertion that was resolved.
     * @param assertedTruthfully Whether the assertion was resolved as truthful or not.
     */
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) external;

    /**
     * @notice Callback function that is called by Optimistic Oracle V3 when an assertion is disputed.
     * @param assertionId The identifier of the assertion that was disputed.
     */
    function assertionDisputedCallback(bytes32 assertionId) external;
}
