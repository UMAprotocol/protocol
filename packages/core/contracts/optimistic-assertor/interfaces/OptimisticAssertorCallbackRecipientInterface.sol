// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

interface OptimisticAssertorCallbackRecipientInterface {
    function assertionResolved(bytes32 assertionId, bool assertedTruthfully) external;

    function assertionDisputed(bytes32 assertionId) external;
}
