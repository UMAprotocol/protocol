// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../interfaces/VotingInterface.sol";
import "../VoteTimingV2.sol";

// Wraps the library VoteTiming for testing purposes.
contract VoteTimingV2Test {
    using VoteTimingV2 for VoteTimingV2.Data;

    VoteTimingV2.Data public voteTiming;

    constructor(uint256 phaseLength, uint256 minRollToNextRoundLength) {
        wrapInit(phaseLength, minRollToNextRoundLength);
    }

    function wrapComputeCurrentRoundId(uint256 currentTime) external view returns (uint256) {
        return voteTiming.computeCurrentRoundId(currentTime);
    }

    function wrapComputeCurrentPhase(uint256 currentTime) external view returns (VotingAncillaryInterface.Phase) {
        return voteTiming.computeCurrentPhase(currentTime);
    }

    function wrapComputeRoundToVoteOnPriceRequest(uint256 currentTime) external view returns (uint256) {
        return voteTiming.computeRoundToVoteOnPriceRequest(currentTime);
    }

    function wrapComputeRoundEndTime(uint256 roundId) external view returns (uint256) {
        return voteTiming.computeRoundEndTime(roundId);
    }

    function wrapInit(uint256 phaseLength, uint256 minRollToNextRoundLength) public {
        voteTiming.init(phaseLength, minRollToNextRoundLength);
    }
}
