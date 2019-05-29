pragma solidity ^0.5.0;

import "./FixedPoint.sol";


/**
 * @title Computes vote results.
 * @dev The result is the mode of the added votes, if the mode's frequency is >50%. Otherwise, the vote is unresolved.
 */
library ResultComputation {

    using FixedPoint for FixedPoint.Unsigned;

    struct Data {
        // Maps price to number of tokens that voted for that price.
        mapping(int => FixedPoint.Unsigned) voteFrequency;
        // The total votes that have been added.
        FixedPoint.Unsigned totalVotes;
        // The price that is the current mode, i.e., the price with the highest frequency in `voteFrequency`.
        int currentMode;
    }

    /**
     * @dev Returns whether the result is resolved, and if so, what value it resolved to. `price` should be ignored if
     * `isResolved` is false.
     * @param minVoteThreshold Minimum number of tokens that must have been voted for the result to be valid. Can be
     * used to enforce a minimum voter participation rate, regardless of how the votes are distributed.
     */
    function getResolvedPrice(Data storage data, FixedPoint.Unsigned memory minVoteThreshold)
        internal
        view
        returns (bool isResolved, int price)
    {
        // TODO(ptare): Figure out where this parameter is supposed to come from.
        FixedPoint.Unsigned memory modeThreshold = FixedPoint.fromUnscaledUint(50).div(100);

        if (data.totalVotes.isGreaterThan(minVoteThreshold) &&
            data.voteFrequency[data.currentMode].div(data.totalVotes).isGreaterThan(modeThreshold)) {
            // `modeThreshold` and `minVoteThreshold` are met, so the current mode is the resolved price.
            isResolved = true;
            price = data.currentMode;
        } else {
            isResolved = false;
        }
    }

    /**
     * @dev Adds a new vote to be used when computing the result.
     */
    function addVote(Data storage data, int votePrice, FixedPoint.Unsigned memory numberTokens)
        internal
    {
        data.totalVotes = data.totalVotes.add(numberTokens);
        data.voteFrequency[votePrice] = data.voteFrequency[votePrice].add(numberTokens);
        if (votePrice != data.currentMode
            && data.voteFrequency[votePrice].isGreaterThan(data.voteFrequency[data.currentMode])) {
            data.currentMode = votePrice;
        }
    }

    /**
     * @dev Checks whether a `votePrice` is considered correct. Should only be called after a vote is resolved, i.e.,
     * via `getResolvedPrice`.
     */
    function wasVoteCorrect(Data storage data, int votePrice) internal view returns (bool) {
        return votePrice == data.currentMode;
    }

    /**
     * @dev Gets the total number of tokens whose votes are considered correct. Should only be called after a vote is
     * resolved, i.e., via `getResolvedPrice`.
     */
    function getTotalCorrectlyVotedTokens(Data storage data)
        internal
        view
        returns (FixedPoint.Unsigned memory)
    {
        return data.voteFrequency[data.currentMode];
    }
}
