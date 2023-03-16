// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../../interfaces/SlashingLibraryInterface.sol";
import "../VotingV2.sol";

/**
 * @title Slashing Library contract that uses the price identifier to calculate the amount of tokens to slash.
 */

contract PriceIdentifierSlashingLibaryTest is SlashingLibraryInterface {
    VotingV2 public voting;

    bytes32 public constant whiteListedIdentifier = "SAFE_NO_VOTE";

    uint256 public constant slashPerToken = 0.0016e18;

    constructor(address _votingV2Address) {
        voting = VotingV2(_votingV2Address);
    }

    function calcWrongVoteSlashPerToken(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public pure returns (uint256) {}

    function calcWrongVoteSlashPerTokenGovernance(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public pure returns (uint256) {}

    function calcNoVoteSlashPerToken(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public pure returns (uint256) {}

    function calcSlashing(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes,
        uint256 priceRequestIndex,
        bool isGovernance
    ) external view returns (uint256 wrongVoteSlashPerToken, uint256 noVoteSlashPerToken) {
        bytes32 priceRequestIdentifier = voting.resolvedPriceRequestIds(priceRequestIndex);
        (, , , , bytes32 identifier, ) = voting.priceRequests(priceRequestIdentifier);

        // If the identifier is whiteListedIdentifier, then no tokens are slashed for no vote.
        uint256 noVoteSlashPerToken = identifier == whiteListedIdentifier ? 0 : slashPerToken;

        // If it's a governance price request, then no tokens are slashed for wrong vote.
        uint256 wrongVoteSlashPerToken = isGovernance ? 0 : slashPerToken;

        return (isGovernance ? 0 : slashPerToken, noVoteSlashPerToken);
    }
}
