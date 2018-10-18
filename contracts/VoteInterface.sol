/*
  Interface for a contract that implements commit-reveal voting.
*/
pragma solidity ^0.4.24;

pragma experimental ABIEncoderV2;


// This interface allows users to vote on price changes.
contract VoteInterface {

    struct PriceTime {
        int256 price;
        uint time;
    }

    struct Period {
        uint startTime;
        uint endTime;
    }

    // Commits the sender's vote weighted by their balance at the start of the commit period.
    // Note: this function will fail if the pollId provided is not active or the contract is not in the commit period.
    function commitVote(uint pollId, bytes32 secretHash) external;

    // Reveals the sender's previously committed vote for a particular poll.
    // Note: this function will fail if keccak256(abi.encodePacked(voteOption, salt)) doesn't match the secretHash,
    // this pollId is not currently active, or if the contract is not in the reveal period.
    function revealVote(uint pollId, bool voteOption, uint salt) external;

    // Returns the commit and reveal periods for the active polls. 
    function getCurrentCommitRevealPeriods() external view returns (Period commit, Period reveal);

    // Returns the current period type ("commit", "reveal", or "none").
    function getCurrentPeriodType() external view returns (string periodType);

    // Gets the active pollId.
    function getActivePoll() external view returns (uint pollId);

    // Gets the product that the price votes apply to.
    function getProduct() external view returns (string product);

    // Gets the proposed price-time pairs for a particular pollId.
    // Note: this function will fail if the pollId is not active.
    function getProposal(uint pollId) external view returns (PriceTime[] prices);

    // Gets the proposed price for a particular poll and time.
    // Note: this function will fail if the poll is not active or the time is outside of the bounds of the poll's
    // proposal.
    function getProposedPriceAtTime(uint pollId, uint time) external view returns (int256 price);

    // Gets the committed hash for a particular poll and voter. This is meant to be used as a debugging tool if a call
    // to revealVote() unexpectedly fails.
    // Note: this function will fail is the poll is not currently active or the voter has not participated in this
    // poll.
    function getCommittedVoteForUser(uint pollId, address voter) external view returns (bytes32 secretHash);
}
