pragma solidity ^0.5.0;

import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Library to compute rounds and phases for an equal length commit-reveal voting cycle. 
 */
library VoteTiming {
    using SafeMath for uint;

    // Note: the phases must be in order. Meaning the first enum value must be the first phase, etc.
    enum Phase { Commit, Reveal }

    // Note: this MUST match the number of values in the enum above.
    uint private constant NUM_PHASES = 2;

    struct Data {
        uint phaseLength;
    }

    /**
     * @notice Initializes the data object. Sets the phase length based on the input.
     */
    function init(Data storage data, uint phaseLength) internal {
        data.phaseLength = phaseLength;
    }

    /**
     * @notice Computes the roundID based off the current time as floor(timestamp/phaseLength).
     */
    function computeCurrentRoundId(Data storage data, uint currentTime) internal view returns (uint roundId) {
        uint roundLength = data.phaseLength.mul(NUM_PHASES);
        return currentTime.div(roundLength);
    }

    function computeRoundEndTime(Data storage data, uint roundId) internal view returns (uint timestamp) {
        uint roundLength = data.phaseLength.mul(NUM_PHASES);
        return roundLength.mul(roundId.add(1));
    }

    /**
     * @notice Computes the current phase based only on the current time.
     */
    function computeCurrentPhase(Data storage data, uint currentTime) internal view returns (Phase) {
        // This employs some hacky casting. We could make this an if-statement if we're worried about type safety.
        return Phase(currentTime.div(data.phaseLength).mod(NUM_PHASES));
    }
}
