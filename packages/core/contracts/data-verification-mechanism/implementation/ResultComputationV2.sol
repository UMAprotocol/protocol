// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

/**
 * @title Computes vote results.
 * @dev The result is the mode of the added votes. Otherwise, the vote is unresolved.
 */
library ResultComputationV2 {
    /****************************************
     *   INTERNAL LIBRARY DATA STRUCTURE    *
     ****************************************/

    struct Data {
        mapping(int256 => uint128) voteFrequency; // Maps price to number of tokens that voted for that price.
        uint128 totalVotes; // The total votes that have been added.
        int256 currentMode; // The price that is the current mode, i.e., the price with the highest frequency.
    }

    /****************************************
     *            VOTING FUNCTIONS          *
     ****************************************/

    /**
     * @notice Adds a new vote to be used when computing the result.
     * @param data contains information to which the vote is applied.
     * @param votePrice value specified in the vote for the given `numberTokens`.
     * @param numberTokens number of tokens that voted on the `votePrice`.
     */
    function addVote(
        Data storage data,
        int256 votePrice,
        uint128 numberTokens
    ) internal {
        data.totalVotes += numberTokens;
        data.voteFrequency[votePrice] += numberTokens;
        if (votePrice != data.currentMode && data.voteFrequency[votePrice] > data.voteFrequency[data.currentMode])
            data.currentMode = votePrice;
    }

    /****************************************
     *        VOTING STATE GETTERS          *
     ****************************************/

    /**
     * @notice Returns whether the result is resolved, and if so, what value it resolved to.
     * @dev `price` should be ignored if `isResolved` is false.
     * @param data contains information against which the `minTotalVotes` and `minModalVotes` thresholds are applied.
     * @param minTotalVotes min (exclusive) number of tokens that must have voted (in any direction) for the result
     * to be valid. Used to enforce a minimum voter participation rate, regardless of how the votes are distributed.
     * @param minModalVotes min (exclusive) number of tokens that must have voted for the modal outcome for it to result
     * in a resolution. This is used to avoid cases where the mode is a very small plurality.
     * @return isResolved indicates if the price has been resolved correctly.
     * @return price the price that the dvm resolved to.
     */
    function getResolvedPrice(
        Data storage data,
        uint128 minTotalVotes,
        uint128 minModalVotes
    ) internal view returns (bool isResolved, int256 price) {
        if (data.totalVotes > minTotalVotes && data.voteFrequency[data.currentMode] > minModalVotes) {
            isResolved = true; // minTotalVotes and minModalVotes are exceeded, so the resolved price is the mode.
            price = data.currentMode;
        }
    }

    /**
     * @notice Checks whether a `voteHash` is considered correct.
     * @dev Should only be called after a vote is resolved, i.e., via `getResolvedPrice`.
     * @param data contains information against which the `voteHash` is checked.
     * @param voteHash committed hash submitted by the voter.
     * @return bool true if the vote was correct.
     */
    function wasVoteCorrect(Data storage data, bytes32 voteHash) internal view returns (bool) {
        return voteHash == keccak256(abi.encode(data.currentMode));
    }

    /**
     * @notice Gets the total number of tokens whose votes are considered correct.
     * @dev Should only be called after a vote is resolved, i.e., via `getResolvedPrice`.
     * @param data contains all votes against which the correctly voted tokens are counted.
     * @return uint128 which indicates the frequency of the correctly voted tokens.
     */
    function getTotalCorrectlyVotedTokens(Data storage data) internal view returns (uint128) {
        return data.voteFrequency[data.currentMode];
    }
}
