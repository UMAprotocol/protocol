// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../StakerSnapshot.sol";

contract StakerSnapshotTest is StakerSnapshot {
    constructor(
        uint256 _emissionRate,
        uint256 _unstakeCoolDown,
        address _votingToken,
        address _timer
    ) public StakerSnapshot(_emissionRate, _unstakeCoolDown, _votingToken, _timer) {}

    function applySlashingToCumulativeStaked(address voter, int256 amount) public {
        require(int256(cumulativeStaked) + amount >= 0, "Cumulative staked cannot be negative");
        stakingBalances[voter].cumulativeStaked = uint256(int256(stakingBalances[voter].cumulativeStaked) + amount);
    }
}
