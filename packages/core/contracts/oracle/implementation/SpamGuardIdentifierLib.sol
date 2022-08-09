// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.15;

import "./AdminIdentifierLib.sol";

/**
 * @title Library to construct SpamGuard identifiers.
 */

library SpamGuardIdentifierLib {
    // Returns a UTF-8 identifier representing a particular spam deletion proposal.
    // The identifier is of the form "SpamDeletionProposal n", where n is the proposal id provided.
    function _constructIdentifier(uint32 id) internal pure returns (bytes32) {
        bytes32 bytesId = AdminIdentifierLib._uintToUtf8(id);
        return AdminIdentifierLib._addPrefix(bytesId, "SpamDeletionProposal ", 21);
    }
}
