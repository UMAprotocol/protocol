// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

interface MinimumVotingAncillaryInterface {
    struct Unsigned {
        uint256 rawValue;
    }

    struct PendingRequestAncillary {
        bytes32 identifier;
        uint256 time;
        bytes ancillaryData;
    }

    function retrieveRewards(
        address voterAddress,
        uint256 roundId,
        PendingRequestAncillary[] memory toRetrieve
    ) external returns (Unsigned memory);
}
