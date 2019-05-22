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

    function init(Data storage data, uint phaseLength) internal {
        data.phaseLength = phaseLength;
        data.roundId = 1;
        data.roundStartTime = 0;
    }

    function getLastUpdatedRoundId(Data storage data) internal view returns (uint) {
        return data.roundId;
    }

    function shouldUpdateRoundId(Data storage data, uint currentTime) internal view returns (bool) {
        return data.roundStartTime != _computeCurrentRoundStartTime(data, currentTime);
    }

    function updateRoundId(Data storage data, uint currentTime) internal {
        data.roundId = computeCurrentRoundId(data, currentTime);
        data.roundStartTime = _computeCurrentRoundStartTime(data, currentTime);
    }

    function computeCurrentRoundId(Data storage data, uint currentTime) internal view returns (uint roundId) {
        roundId = data.roundId;
        if (shouldUpdateRoundId(data, currentTime)) {
            roundId = roundId.add(1);
        }
    }

    function computeCurrentPhase(Data storage data, uint currentTime) internal view returns (Phase) {
        // This employs some hacky casting. We could make this an if-statement if we're worried about type safety.
        return Phase(currentTime.div(data.phaseLength).mod(NUM_PHASES));
    }

    function computeEstimatedRoundEndTime(Data storage data, uint roundId) internal view returns (uint) {
        // The add(1) is because we want the round end time rather than the start time, so it's really the start of
        // the next round.
        uint roundDiff = roundId.sub(data.roundId).add(1);
        uint roundLength = data.phaseLength.mul(NUM_PHASES);
        return data.roundStartTime.add(roundDiff.mul(roundLength));
    }

    function _computeCurrentRoundStartTime(Data storage data, uint currentTime) private view returns (uint) {
        uint roundLength = data.phaseLength.mul(NUM_PHASES);
        return currentTime.div(roundLength).mul(roundLength);
    }
}
