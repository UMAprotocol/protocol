pragma solidity ^0.5.0;

import "../ResultComputation.sol";


// Wraps the library ResultComputation for testing purposes.
contract ResultComputationTest {
    using ResultComputation for ResultComputation.ResultComputationData;

    ResultComputation.ResultComputationData public data;

    function wrapAddVote(int votePrice, uint numberTokens) external {
        data.addVote(votePrice, numberTokens);
    }

    function wrapGetResolvedPrice() external view returns (int) {
        return data.getResolvedPrice();
    }
}
