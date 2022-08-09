// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../Staker.sol";
import "../../../common/implementation/Testable.sol";

// Version of the Staker contract used in tests so time can be controlled.
contract StakerControlledTiming is Staker, Testable {
    constructor(
        uint256 _emissionRate,
        uint64 _unstakeCoolDown,
        address _votingToken,
        address _timerAddress
    ) Staker(_emissionRate, _unstakeCoolDown, _votingToken) Testable(_timerAddress) {}

    function getCurrentTime() public view virtual override(Staker, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }
}

contract StakerTest is StakerControlledTiming {
    constructor(
        uint256 _emissionRate,
        uint64 _unstakeCoolDown,
        address _votingToken,
        address _timer
    ) StakerControlledTiming(_emissionRate, _unstakeCoolDown, _votingToken, _timer) {}

    function applySlashingToCumulativeStaked(address voter, int256 amount) public {
        _updateTrackers(voter); // apply any unaccumulated rewards before modifying the staked balances.
        require(int256(cumulativeActiveStake) + amount >= 0, "Cumulative staked cannot be negative");
        voterStakes[voter].activeStake = uint256(int256(voterStakes[voter].activeStake) + amount);
    }

    function inActiveReveal() internal view override returns (bool) {
        return false;
    }

    function getStartingIndexForStaker() internal view override returns (uint64) {
        return 0;
    }
}
