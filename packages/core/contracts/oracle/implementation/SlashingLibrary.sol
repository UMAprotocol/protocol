// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

contract SlashingLibrary {
    /**
     * @notice Calculates the wrong vote slash per token.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @return uint256 The amount of tokens to slash.
     */
    function calcWrongVoteSlashPerToken(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes
    ) public pure returns (uint256) {
        // This number is equal to the slash amount needed to cancel an APY of 20%
        // if 10 votes are cast each month for a year. 0.2/(10*12)= ~0.0016
        return 1600000000000000;
    }

    /**
     * @notice Calculates the wrong vote slash per token for governance requests.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @return uint256 The amount of tokens to slash.
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
     * @return uint256 The amount of tokens to slash.
     */
    function calcNoVoteSlashPerToken(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes
    ) public pure returns (uint256) {
        // This number is equal to the slash amount needed to cancel an APY of 20%
        // if 10 votes are cast each month for a year. 0.2/(10*12)= ~0.0016
        return 1600000000000000;
    }
}
