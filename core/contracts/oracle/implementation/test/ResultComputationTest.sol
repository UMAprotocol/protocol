pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../ResultComputation.sol";
import "../../../common/FixedPoint.sol";


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

    function wrapWasVoteCorrect(bytes32 revealHash) external view returns (bool) {
        return data.wasVoteCorrect(revealHash);
    }

    function wrapGetTotalCorrectlyVotedTokens() external view returns (uint) {
        return data.getTotalCorrectlyVotedTokens().rawValue;
    }
}
