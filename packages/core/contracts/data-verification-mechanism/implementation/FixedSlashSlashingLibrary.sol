// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../interfaces/SlashingLibraryInterface.sol";

/**
 * @title Slashing Library contract. Returns the how much a voter should be slashed per staked token as a function of
 * the total staked, total votes and total correct votes. Can be upgraded to a new implementation to enable more
 elaborate slashing algorithms via UMA governance.
 */

contract FixedSlashSlashingLibrary is SlashingLibraryInterface {
    uint256 public immutable baseSlashAmount; // Slash amount per token for missed votes and wrong non-governance votes.
    uint256 public immutable governanceSlashAmount; // Slash amount per token for wrong governance votes.

    /**
     * @notice Construct the FixedSlashSlashingLibrary contract.
     * @param _baseSlashAmount Slash amount per token for missed votes and wrong non-governance votes.
     * @param _governanceSlashAmount Slash amount per token for wrong governance votes.
     */
    constructor(uint256 _baseSlashAmount, uint256 _governanceSlashAmount) {
        require(_baseSlashAmount < 1e18, "Invalid base slash amount");
        require(_governanceSlashAmount < 1e18, "Invalid governance slash amount");
        baseSlashAmount = _baseSlashAmount; // Slash amount per token for missed votes and wrong non-governance votes.
        governanceSlashAmount = _governanceSlashAmount; // Slash amount per token for wrong governance votes.
    }

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
    ) public view returns (uint256) {
        return baseSlashAmount;
    }

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
    ) public view returns (uint256) {
        return governanceSlashAmount;
    }

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
    ) public view returns (uint256) {
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
        uint256 totalStaked,
        uint256 totalVotes,
        uint256 totalCorrectVotes,
        uint256 priceRequestIndex,
        bool isGovernance
    ) external view returns (uint256 wrongVoteSlashPerToken, uint256 noVoteSlashPerToken) {
        return (
            isGovernance
                ? calcWrongVoteSlashPerTokenGovernance(totalStaked, totalVotes, totalCorrectVotes, priceRequestIndex)
                : calcWrongVoteSlashPerToken(totalStaked, totalVotes, totalCorrectVotes, priceRequestIndex),
            calcNoVoteSlashPerToken(totalStaked, totalVotes, totalCorrectVotes, priceRequestIndex)
        );
    }
}
