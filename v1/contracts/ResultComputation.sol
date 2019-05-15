pragma solidity ^0.5.0;

import "./FixedPoint.sol";


/**
 * @title Computes vote results.
 * @dev The result is the mode of the added votes, if the mode's frequency is >50%. Otherwise, the vote is unresolved.
 */
library ResultComputation {

    using FixedPoint for FixedPoint.Unsigned;

    struct ResultComputationData {
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
     */
    function getResolvedPrice(ResultComputationData storage data) internal view returns (bool isResolved, int price) {
        // TODO(ptare): Figure out where this parameter is supposed to come from.
        FixedPoint.Unsigned memory modeThreshold = FixedPoint.fromUnscaledUint(50).div(100);

        FixedPoint.Unsigned memory modeFrequency = data.voteFrequency[data.currentMode];
        if (modeFrequency.isGreaterThan(FixedPoint.fromUnscaledUint(0)) &&
            modeFrequency.div(data.totalVotes).isGreaterThan(modeThreshold)) {
            // `modeThreshold` is met, so the current mode is the resolved price.
            isResolved = true;
            price = data.currentMode;
        } else {
            isResolved = false;
        }
    }

    /**
     * @dev Adds a new vote to be used when computing the result.
     */
    function addVote(ResultComputationData storage data, int votePrice, FixedPoint.Unsigned memory numberTokens) internal {
        data.totalVotes = data.totalVotes.add(numberTokens);
        data.voteFrequency[votePrice] = data.voteFrequency[votePrice].add(numberTokens);
        if (data.voteFrequency[votePrice].isGreaterThan(data.voteFrequency[data.currentMode])) {
            data.currentMode = votePrice;
        }
    }
}
