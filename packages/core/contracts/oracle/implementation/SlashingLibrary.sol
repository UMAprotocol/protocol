// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

/**
 * @title Slashing Library contract. Returns the how much a voter should be slashed per staked token as a function of
 * the total staked, total votes and total correct votes. Can be upgraded to a new implementation to enable more
 elaborate slashing algorithms via UMA governance.
 */

contract SlashingLibrary {
    /**
     * @notice Calculates the wrong vote slash per token.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @return uint256 The amount of tokens to slash per token staked.
     */
    function calcWrongVoteSlashPerToken(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes
    ) public pure returns (uint256) {
        // This number is equal to the slash amount needed to cancel an APY of 20%
        // if 10 votes are cast each month for a year.  1 - (1 / 1.2)**(1/120) = ~0.0016
        // When changing this value, make sure that:
        // (1 + APY) * ( 1 - calcWrongVoteSlashPerToken() )**expected_yearly_votes < 1
        return 0.0016e18;
    }

    /**
     * @notice Calculates the wrong vote slash per token for governance requests.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @return uint256 The amount of tokens to slash per token staked.
     */
    function calcWrongVoteSlashPerTokenGovernance(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes
    ) public pure returns (uint256) {
        return 0;
    }

    /**
     * @notice Calculates the no vote slash per token.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @return uint256 The amount of tokens to slash per token staked.
     */
    function calcNoVoteSlashPerToken(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes
    ) public pure returns (uint256) {
        // This number is equal to the slash amount needed to cancel an APY of 20%
        // if 10 votes are cast each month for a year. 1 - (1 / 1.2)**(1/120) = ~0.0016
        // When changing this value, make sure that:
        // (1 + APY) * ( 1 - calcNoVoteSlashPerToken() )**expected_yearly_votes < 1
        return 0.0016e18;
    }

    /**
     * @notice Calculates all slashing trackers in one go to decrease cross-contract calls needed.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @return  wrongVoteSlashPerToken The amount of tokens to slash for voting wrong.
     * @return noVoteSlashPerToken The amount of tokens to slash for not voting.
     */
    function calcSlashing(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes,
        bool isGovernance
    ) external pure returns (uint256 wrongVoteSlashPerToken, uint256 noVoteSlashPerToken) {
        return (
            isGovernance
                ? calcWrongVoteSlashPerTokenGovernance(totalStaked, totalVotes, totalCorrectVotes)
                : calcWrongVoteSlashPerToken(totalStaked, totalVotes, totalCorrectVotes),
            calcNoVoteSlashPerToken(totalStaked, totalVotes, totalCorrectVotes)
        );
    }
}
