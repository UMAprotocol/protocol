pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "../ResultComputation.sol";
import "../FixedPoint.sol";


 // Wraps the library ResultComputation for testing purposes.
contract ResultComputationTest {
    using ResultComputation for ResultComputation.Data;

    ResultComputation.Data public data;

    function wrapAddVote(int votePrice, uint numberTokens) external {
        data.addVote(votePrice, FixedPoint.Unsigned(numberTokens));
    }

    function wrapGetResolvedPrice(uint minVoteThreshold) external view returns (bool isResolved, int price) {
        return data.getResolvedPrice(FixedPoint.Unsigned(minVoteThreshold));
    }

    function wrapWasVoteCorrect(int votePrice) external view returns (bool) {
        return data.wasVoteCorrect(votePrice);
    }

    function wrapGetTotalCorrectlyVotedTokens() external view returns (uint) {
        return data.getTotalCorrectlyVotedTokens().value;
    }
}

