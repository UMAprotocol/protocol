// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./VotingV2.sol";
import "SpamIdentifierLib.sol";

contract SpamGuard is VotingV2 {
    uint256 bond;

    struct SpamDeletionRequest {
        uint256[2][] spamRequestIndices;
        uint256 roundId;
        bool executed;
        address proposer;
    }

    // Maps round numbers to the spam deletion request.
    SpamDeletionRequest[] public spamDeletionRequests;

    constructor(
        uint256 _emissionRate,
        uint256 _unstakeCoolDown,
        uint256 _phaseLength,
        FixedPoint.Unsigned memory _gatPercentage,
        address _votingToken,
        address _finder,
        address _timerAddress,
        address _slashingLibrary
    )
        VotingV2(
            _emissionRate,
            _unstakeCoolDown,
            _phaseLength,
            _gatPercentage,
            _votingToken,
            _finder,
            _timerAddress,
            _slashingLibrary
        )
    {
        setBond(10e18);
    }

    function signalRequestsAsSpam(uint256[2][] memory spamRequestIndices) public {
        votingToken.transferFrom(msg.sender, address(this), bond);
        uint256 currentRoundId = getCurrentRoundId();
        uint256 runningValidationIndex;
        for (uint256 i = 0; i < spamRequestIndices.length; i++) {
            // Check request end index is greater than start index.
            require(spamRequestIndices[i][0] <= spamRequestIndices[i][1], "Bad start index");
            runningValidationIndex = spamRequestIndices[i][1];

            // check the endIndex is less than the total number of requests.
            require(spamRequestIndices[i][1] < priceRequestIds.length, "Bad end index");

            // Validate index continuity. This checks that each sequential element within the spamRequestIndices
            // array is sequently and increasing in size.
            require(spamRequestIndices[i][1] > runningValidationIndex, "Bad index continuity");
            runningValidationIndex = spamRequestIndices[i][1];

            // The associated roundId of the first and last index must be the same and must be the same as the current
            // round.
            require(
                priceRequestIds[spamRequestIndices[i][0]].roundId ==
                    priceRequestIds[spamRequestIndices[i][1]].roundId &&
                    priceRequestIds[spamRequestIndices[i][0]].roundId == currentRoundId,
                "Bad round id"
            );
        }

        spamDeletionRequests.push(SpamDeletionRequest(spamRequestIndices, currentRoundId, false, msg.sender));
        uint256 spamDeletionRequestId = spamDeletionRequests.length;

        bytes32 identifier = SpamIdentifierLib._constructIdentifier(spamDeletionRequestId);

        // todo: consider if we want to check if the most recent price request has been settled?
    }

    function setBond(uint256 _bond) public onlyOwner() {
        bond = _bond;
    }
}
