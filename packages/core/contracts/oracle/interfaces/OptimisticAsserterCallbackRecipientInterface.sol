// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

interface OptimisticAsserterCallbackRecipientInterface {
    function assertionResolved(bytes32 assertionId, bool assertedThruthfully) external;
}
