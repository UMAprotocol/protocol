pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";


/**
 * @title VoteTiming
 * @dev Computes rounds and phases for an equal length commit-reveal voting cycle. 
 */
library VoteTiming {
    using SafeMath for uint;

    // Note: the phases must be in order. Meaning the first enum value must be the first phase, etc.
    enum Phase {
        Commit,
        Reveal
    }

    // Note: this MUST match the number of values in the enum above.
    uint private constant NUM_PHASES = 2;

    struct Data {
        uint roundId;
        uint roundStartTime;
        uint phaseLength;
    }

    /**
     * @notice Initializes the data object. Sets the phase length based on the input and resets the round id and round
     * start time to 1 and 0 respectively.
     * @dev This method should generally only be run once, but it can also be used to reset the data structure to its
     * initial values.
     */
    function init(Data storage data, uint phaseLength) internal {
        data.phaseLength = phaseLength;
        data.roundId = 1;
        data.roundStartTime = 0;
    }

    /**
     * @notice Gets the most recently stored round ID set by updateRoundId().
     */
    function getLastUpdatedRoundId(Data storage data) internal view returns (uint) {
        return data.roundId;
    }

    /**
     * @notice Determines whether time has advanced far enough to advance to the next voting round and update the
     * stored round id.
     */
    function shouldUpdateRoundId(Data storage data, uint currentTime) internal view returns (bool) {
        (uint roundId,) = _getCurrentRoundIdAndStartTime(data, currentTime);
        return data.roundId != roundId;
    }

    /**
     * @notice Updates the round id. Note: if shouldUpdateRoundId() returns false, this method will have no effect.
     */
    function updateRoundId(Data storage data, uint currentTime) internal {
        (data.roundId, data.roundStartTime) = _getCurrentRoundIdAndStartTime(data, currentTime);
    }

    /**
     * @notice Computes what the stored round id would be if it were updated right now, but this method does not
     * commit the update.
     */
    function computeCurrentRoundId(Data storage data, uint currentTime) internal view returns (uint roundId) {
        (roundId,) = _getCurrentRoundIdAndStartTime(data, currentTime);
    }

    /**
     * @notice Computes the current phase based only on the current time.
     */
    function computeCurrentPhase(Data storage data, uint currentTime) internal view returns (Phase) {
        // This employs some hacky casting. We could make this an if-statement if we're worried about type safety.
        return Phase(currentTime.div(data.phaseLength).mod(NUM_PHASES));
    }

    /**
     * @notice Gets the end time of the current round or any round in the future. Note: this method will revert if
     * the roundId < getLastUpdatedRoundId().
     */
    function computeEstimatedRoundEndTime(Data storage data, uint roundId) internal view returns (uint) {
        // The add(1) is because we want the round end time rather than the start time, so it's really the start of
        // the next round.
        uint roundDiff = roundId.sub(data.roundId).add(1);
        uint roundLength = data.phaseLength.mul(NUM_PHASES);
        return data.roundStartTime.add(roundDiff.mul(roundLength));
    }

    /**
     * @dev Computes an updated round id and round start time based on the current time.
     */
    function _getCurrentRoundIdAndStartTime(Data storage data, uint currentTime)
        private
        view
        returns (uint roundId, uint startTime)
    {
        uint currentStartTime = data.roundStartTime;
        // Return current data if time has moved backwards.
        if (currentTime <= data.roundStartTime) {
            return (data.roundId, data.roundStartTime);
        }

        // Get the start of the round that currentTime would be a part of by flooring by roundLength.
        uint roundLength = data.phaseLength.mul(NUM_PHASES);
        startTime = currentTime.div(roundLength).mul(roundLength);

        // Only increment the round ID if the start time has changed.
        if (startTime > currentStartTime) {
            roundId = data.roundId.add(1);
        } else {
            roundId = data.roundId;
        }
    }
}
