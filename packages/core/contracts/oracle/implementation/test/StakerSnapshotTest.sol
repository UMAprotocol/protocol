// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../Staker.sol";

contract StakerTest is Staker {
    constructor(
        uint256 _emissionRate,
        uint256 _unstakeCoolDown,
        address _votingToken,
        address _timer
    ) public Staker(_emissionRate, _unstakeCoolDown, _votingToken, _timer) {}

    function applySlashingToCumulativeStaked(address voter, int256 amount) public {
        _updateTrackers(voter); // apply any unaccumulated rewards before modifying the staked balances.
        require(int256(cumulativeStaked) + amount >= 0, "Cumulative staked cannot be negative");
        voterStakes[voter].cumulativeStaked = uint256(int256(voterStakes[voter].cumulativeStaked) + amount);
    }
}
