// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

interface SlashingLibraryInterface {
    /**
     * @notice Calculates the wrong vote slash per token.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @param priceRequestIndex The price request index within the resolvedPriceRequestIds array.
     * @return uint256 The amount of tokens to slash per token staked.
     */
    function calcWrongVoteSlashPerToken(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes,
        uint256 priceRequestIndex
    ) external view returns (uint256);

    /**
     * @notice Calculates the wrong vote slash per token for governance requests.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @param priceRequestIndex The price request index within the resolvedPriceRequestIds array.
     * @return uint256 The amount of tokens to slash per token staked.
     */
    function calcWrongVoteSlashPerTokenGovernance(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes,
        uint256 priceRequestIndex
    ) external view returns (uint256);

    /**
     * @notice Calculates the no vote slash per token.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @param priceRequestIndex The price request index within the resolvedPriceRequestIds array.
     * @return uint256 The amount of tokens to slash per token staked.
     */
    function calcNoVoteSlashPerToken(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes,
        uint256 priceRequestIndex
    ) external view returns (uint256);

    /**
     * @notice Calculates all slashing trackers in one go to decrease cross-contract calls needed.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @param priceRequestIndex The price request index within the resolvedPriceRequestIds array.
     * @param isGovernance Whether the request is a governance request.
     * @return wrongVoteSlashPerToken The amount of tokens to slash for voting wrong.
     * @return noVoteSlashPerToken The amount of tokens to slash for not voting.
     */
    function calcSlashing(
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes,
        uint256 priceRequestIndex,
        bool isGovernance
    ) external view returns (uint256 wrongVoteSlashPerToken, uint256 noVoteSlashPerToken);
}
