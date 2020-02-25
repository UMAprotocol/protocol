pragma solidity ^0.6.0;

import "../../interfaces/VotingInterface.sol";
import "../VoteTiming.sol";


// Wraps the library VoteTiming for testing purposes.
contract VoteTimingTest {
    using VoteTiming for VoteTiming.Data;

    VoteTiming.Data public voteTiming;

    constructor(uint phaseLength) public {
        wrapInit(phaseLength);
    }

    function wrapComputeCurrentRoundId(uint currentTime) external view returns (uint) {
        return voteTiming.computeCurrentRoundId(currentTime);
    }

    function wrapComputeCurrentPhase(uint currentTime) external view returns (VotingInterface.Phase) {
        return voteTiming.computeCurrentPhase(currentTime);
    }

    function wrapInit(uint phaseLength) public {
        voteTiming.init(phaseLength);
    }
}
