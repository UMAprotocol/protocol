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

    uint128 public constant slashPerToken = 0.0016e18;

    constructor(address _votingV2Address) {
        voting = VotingV2(_votingV2Address);
    }

    function calcWrongVoteSlashPerToken(
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public pure returns (uint128) {}

    function calcWrongVoteSlashPerTokenGovernance(
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public pure returns (uint128) {}

    function calcNoVoteSlashPerToken(
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public pure returns (uint128) {}

    function calcSlashing(
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex,
        bool isGovernance
    ) external view returns (uint128 wrongVoteSlashPerToken, uint128 noVoteSlashPerToken) {
        bytes32 priceRequestIdentifier = voting.resolvedPriceRequestIds(priceRequestIndex);
        (, , , , bytes32 identifier, ) = voting.priceRequests(priceRequestIdentifier);

        // If the identifier is whiteListedIdentifier, then no tokens are slashed for no vote.
        uint128 noVoteSlashPerToken = identifier == whiteListedIdentifier ? 0 : slashPerToken;

        // If it's a governance price request, then no tokens are slashed for wrong vote.
        uint128 wrongVoteSlashPerToken = isGovernance ? 0 : slashPerToken;

        return (isGovernance ? 0 : slashPerToken, noVoteSlashPerToken);
    }
}
