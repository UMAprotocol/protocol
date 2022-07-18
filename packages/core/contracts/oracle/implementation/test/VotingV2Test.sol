// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../VotingV2.sol";

// Test contract used to manage the time for the contract in tests.
contract VotingV2ControllableTiming is VotingV2, Testable {
    constructor(
        uint256 _emissionRate,
        uint256 _spamDeletionProposalBond,
        uint256 _unstakeCoolDown,
        uint256 _phaseLength,
        uint256 _minRollToNextRoundLength,
        uint256 _gatPercentage,
        address _votingToken,
        address _finder,
        address _slashingLibrary,
        address _timerAddress
    )
        VotingV2(
            _emissionRate,
            _spamDeletionProposalBond,
            _unstakeCoolDown,
            _phaseLength,
            _minRollToNextRoundLength,
            _gatPercentage,
            _votingToken,
            _finder,
            _slashingLibrary
        )
        Testable(_timerAddress)
    {}

    function getCurrentTime() public view override(Staker, Testable) returns (uint256) {
        return Testable.getCurrentTime();
    }
}

// Test contract used to access internal variables in the Voting contract.
contract VotingV2Test is VotingV2ControllableTiming {
    constructor(
        uint256 _emissionRate,
        uint256 _spamDeletionProposalBond,
        uint256 _unstakeCoolDown,
        uint256 _phaseLength,
        uint256 _minRollToNextRoundLength,
        uint256 _gatPercentage,
        address _votingToken,
        address _finder,
        address _slashingLibrary,
        address _timerAddress
    )
        VotingV2ControllableTiming(
            _emissionRate,
            _spamDeletionProposalBond,
            _unstakeCoolDown,
            _phaseLength,
            _minRollToNextRoundLength,
            _gatPercentage,
            _votingToken,
            _finder,
            _slashingLibrary,
            _timerAddress
        )
    {}

    function getPendingPriceRequestsArray() external view returns (bytes32[] memory) {
        return pendingPriceRequests;
    }
}
