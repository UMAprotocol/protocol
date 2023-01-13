// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../interfaces/SlashingLibraryInterface.sol";

/**
 * @title Slashing Library contract. Returns the how much a voter should be slashed per staked token as a function of
 * the total staked, total votes and total correct votes. Can be upgraded to a new implementation to enable more
 elaborate slashing algorithms via UMA governance.
 */

contract FixedSlashSlashingLibrary is SlashingLibraryInterface {
    uint128 public immutable baseSlashAmount;
    uint128 public immutable governanceSlashAmount;

    constructor(uint128 _baseSlashAmount, uint128 _governanceSlashAmount) {
        baseSlashAmount = _baseSlashAmount;
        governanceSlashAmount = _governanceSlashAmount;
    }

    /**
     * @notice Calculates the wrong vote slash per token.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @param priceRequestIndex The price request index within the resolvedPriceRequestIds array.
     * @return uint128 The amount of tokens to slash per token staked.
     */
    function calcWrongVoteSlashPerToken(
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public view returns (uint128) {
        return baseSlashAmount;
    }

    /**
     * @notice Calculates the wrong vote slash per token for governance requests.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @param priceRequestIndex The price request index within the resolvedPriceRequestIds array.
     * @return uint128 The amount of tokens to slash per token staked.
     */
    function calcWrongVoteSlashPerTokenGovernance(
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public view returns (uint128) {
        return governanceSlashAmount;
    }

    /**
     * @notice Calculates the no vote slash per token.
     * @param totalStaked The total amount of tokens staked.
     * @param totalVotes The total amount of votes.
     * @param totalCorrectVotes The total amount of correct votes.
     * @param priceRequestIndex The price request index within the resolvedPriceRequestIds array.
     * @return uint128 The amount of tokens to slash per token staked.
     */
    function calcNoVoteSlashPerToken(
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public view returns (uint128) {
        return baseSlashAmount;
    }

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
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex,
        bool isGovernance
    ) external view returns (uint128 wrongVoteSlashPerToken, uint128 noVoteSlashPerToken) {
        return (
            isGovernance
                ? calcWrongVoteSlashPerTokenGovernance(totalStaked, totalVotes, totalCorrectVotes, priceRequestIndex)
                : calcWrongVoteSlashPerToken(totalStaked, totalVotes, totalCorrectVotes, priceRequestIndex),
            calcNoVoteSlashPerToken(totalStaked, totalVotes, totalCorrectVotes, priceRequestIndex)
        );
    }
}
