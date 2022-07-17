// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../VotingV2.sol";

// Test contract used to access internal variables in the Voting contract.
contract VotingV2Test is VotingV2 {
    bool shouldRevertOnUpdateTrackers = false;

    constructor(
        uint256 _emissionRate,
        uint256 _spamDeletionProposalBond,
        uint256 _unstakeCoolDown,
        uint256 _phaseLength,
        uint256 _minRollToNextRoundLength,
        uint256 _gatPercentage,
        address _votingToken,
        address _finder,
        address _timerAddress,
        address _slashingLibrary
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
            _timerAddress,
            _slashingLibrary
        )
    {}

    function getPendingPriceRequestsArray() external view returns (bytes32[] memory) {
        return pendingPriceRequests;
    }

    function setRevertOnUpdateTrackers(bool _shouldRevertOnUpdateTrackers) external {
        shouldRevertOnUpdateTrackers = _shouldRevertOnUpdateTrackers;
    }

    function _updateTrackers(address voterAddress) internal override {
        require(!shouldRevertOnUpdateTrackers, "Contract mocked bricked");
        super._updateTrackers(voterAddress);
    }
}
