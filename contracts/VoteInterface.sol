/*
  Interface for a contract that implements commit-reveal voting.
*/
pragma solidity ^0.5.0;


pragma experimental ABIEncoderV2;

import "./PriceTime.sol";


library Proposal {
    struct Data {
        uint numVotes;
        string ipfsHash;
    }
}


// This interface allows users to vote on price changes.
contract VoteInterface {

    struct Period {
        uint startTime;
        uint endTime;
        string state;
    }

    // Commits the sender's vote weighted by their balance at the start of the commit period.
    // Note: this function will fail if the pollId provided is not active or the contract is not in the commit period.
    function commitVote(bytes32 secretHash) external;

    // Reveals the sender's previously committed vote for a particular poll.
    // Note: this function will fail if keccak256(abi.encodePacked(voteOption, salt)) doesn't match the secretHash,
    // this pollId is not currently active, or if the contract is not in the reveal period.
    function revealVote(uint voteOption, uint salt) external;

    // Returns the commit and reveal periods for the active polls. 
    function getCurrentCommitRevealPeriods() external view returns (Period[] memory periods);

    // Returns the current period type ("commit", "reveal", or "none").
    function getCurrentPeriodType() external view returns (string memory periodType);

    // Gets the product that the price votes apply to.
    function getProduct() external view returns (string memory product);

    // Gets the runoff/alternative proposals for the current period.
    function getProposals() external view returns (Proposal.Data[] memory proposals);

    // Gets the default proposal (option 1 during the primary vote period) for the current period.
    function getDefaultProposalPrices() external view returns (PriceTime.Data[] memory defaultProposal);

    // Gets the default proposal (option 1 during the primary vote period) price for a particular time during the
    // current period.
    function getDefaultProposedPriceAtTime(uint time) external view returns (int256 price);

    // Gets the committed hash for a particular poll and voter. This is meant to be used as a debugging tool if a call
    // to revealVote() unexpectedly fails.
    // Note: this function will fail if the voter has not participated in this poll or if the voter has already
    // revealed their vote for this poll.
    function getCommittedVoteForUser(address voter) external view returns (bytes32 secretHash);
}
