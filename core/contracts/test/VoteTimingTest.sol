pragma solidity ^0.5.0;

import "../VoteTiming.sol";


 // Wraps the library VoteTiming for testing purposes.
contract VoteTimingTest {
    using VoteTiming for VoteTiming.Data;

    VoteTiming.Data public voteTiming;

    constructor(uint phaseLength) public {
        wrapInit(phaseLength);
    }

    function wrapUpdateRoundId(uint currentTime) external {
        voteTiming.updateRoundId(currentTime);
    }

    function wrapGetLastUpdatedRoundId() external view returns (uint) {
        return voteTiming.getLastUpdatedRoundId();
    }

    function wrapShouldUpdateRoundId(uint currentTime) external view returns (bool) {
        return voteTiming.shouldUpdateRoundId(currentTime);
    }

    function wrapComputeCurrentRoundId(uint currentTime) external view returns (uint) {
        return voteTiming.computeCurrentRoundId(currentTime);
    }

    function wrapComputeCurrentPhase(uint currentTime) external view returns (VoteTiming.Phase) {
        return voteTiming.computeCurrentPhase(currentTime);
    }

    function wrapComputeEstimatedRoundEndTime(uint roundId) external view returns (uint) {
        return voteTiming.computeEstimatedRoundEndTime(roundId);
    }

    function wrapInit(uint phaseLength) public {
        voteTiming.init(phaseLength);
    }
}
