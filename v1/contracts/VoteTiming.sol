pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title VoteTiming
 * @dev Computes rounds and phases for an equal length commit-reveal voting cycle. 
 */
library VoteTiming {
    using SafeMath for uint;

    enum Phase {
        Commit,
        Reveal
    }

    // Note: this MUST match the number of values in the enum above.
    uint private constant NUM_PHASES = 2;

    struct Data {
        uint currentRoundId;
        uint phaseLength;
    }

    function init(Data storage data, uint phaseLength) internal {
        data.phaseLength = phaseLength;
    }

    function canUpdateRound(Data storage data, uint currentTime) internal returns (bool) {
        return data.currentRoundId != getUpdatedRound(data, currentTime);
    }

    function getLastUpdatedRound(Data storage data) internal returns (uint) {
        return data.currentRoundId;
    }

    function updateRound(Data storage data, uint currentTime) internal returns (bool didUpdate, uint newRoundId) {
        data.currentRoundId = getUpdatedRound(data, currentTime);
    }

    function getUpdatedRound(Data storage data, uint currentTime) internal returns (uint) {
        return currentTime.div(phaseLength.mul(NUM_PHASES));
    }

    function getUpdatedPhase(Data storage data, uint currentTime) internal returns (Phase) {
        // Kinda hacky casting. We could make this an if-statement if we're worried about type safety.
        return Phase(currentTime.div(phaseLength).mod(NUM_PHASES));
    }
}