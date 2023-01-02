// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

interface OptimisticAsserterCallbackRecipientInterface {
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) external;

    function assertionDisputedCallback(bytes32 assertionId) external;
}
