// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../Voting.sol";
import "../../../common/implementation/FixedPoint.sol";

// Test contract used to access internal variables in the Voting contract.
contract VotingTest is Voting {
    constructor(
        uint256 _phaseLength,
        FixedPoint.Unsigned memory _gatPercentage,
        FixedPoint.Unsigned memory _inflationRate,
        uint256 _rewardsExpirationTimeout,
        address _votingToken,
        address _finder,
        address _timerAddress
    )
        Voting(
            _phaseLength,
            _gatPercentage,
            _inflationRate,
            _rewardsExpirationTimeout,
            _votingToken,
            _finder,
            _timerAddress
        )
    {}

    function getPendingPriceRequestsArray() external view returns (bytes32[] memory) {
        return pendingPriceRequests;
    }
}
