pragma solidity ^0.6.0;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../interfaces/VotingInterface.sol";


/**
 * @title Library to compute rounds and phases for an equal length commit-reveal voting cycle.
 */
library VoteTiming {
    using SafeMath for uint;

    struct Data {
        uint256 phaseLength;
    }

    /**
     * @notice Initializes the data object. Sets the phase length based on the input.
     */
    function init(Data storage data, uint256 phaseLength) internal {
        // This should have a require message but this results in an internal Solidity error.
        require(phaseLength > 0);
        data.phaseLength = phaseLength;
    }

    /**
     * @notice Computes the roundID based off the current time as floor(timestamp/phaseLength).
     * @param data input data object.
     * @param currentTime input unix timeStamp used to compute the current roundId.
     * @return roundId defined as a function of the currentTime and `phaseLength` from `data`.
     */
    function computeCurrentRoundId(Data storage data, uint256 currentTime) internal view returns (uint256 roundId) {
        uint256 roundLength = data.phaseLength.mul(uint(VotingInterface.Phase.NUM_PHASES_PLACEHOLDER));
        return currentTime.div(roundLength);
    }

    /**
     * @notice compute the round end time as a function of the round Id.
     * @param data input data object.
     * @param roundId uniquely identifies the current round.
     * @return timestamp unix time of when the current round will end.
     */
    function computeRoundEndTime(Data storage data, uint256 roundId) internal view returns (uint256 timestamp) {
        uint256 roundLength = data.phaseLength.mul(uint(VotingInterface.Phase.NUM_PHASES_PLACEHOLDER));
        return roundLength.mul(roundId.add(1));
    }

    /**
     * @notice Computes the current phase based only on the current time.
     */
    function computeCurrentPhase(Data storage data, uint256 currentTime) internal view returns (VotingInterface.Phase) {
        // This employs some hacky casting. We could make this an if-statement if we're worried about type safety.
        return
            VotingInterface.Phase(
                currentTime.div(data.phaseLength).mod(uint(VotingInterface.Phase.NUM_PHASES_PLACEHOLDER))
            );
    }
}
