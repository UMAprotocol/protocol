/*
  VoteCoin implementation

  Implements an early version of VoteCoin protocols

  * ERC20 token
  * Uses Oraclize to fetch ETH/USD exchange rate
  * Allows users to vote yes/no on whether a price is accurate

*/
pragma solidity ^0.4.24;

pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "./Derivative.sol";
import "./VoteInterface.sol";
import "./OracleInterface.sol";


contract VoteCoin is ERC20, VoteInterface, OracleInterface, Ownable {

    // Note: SafeMath only works for uints right now.
    using SafeMath for uint;

    enum PeriodType {
        Commit,
        Reveal
    }

    PeriodType public period;

    uint public currentPollStartTime;
    uint public currentPollId;

    string public product;

    struct Poll {
        uint votesFor;
        uint votesAgainst;
        mapping(address => bytes32) committedVotes;
    }

    mapping(uint => Poll) private polls;

    uint private constant SECONDS_PER_WEEK = 604800;
    uint private constant SECONDS_PER_THREE_DAYS = 259200;
    uint private constant MONDAY_EPOCH_EST_OFFSET = 327600;

    constructor(string _product) public {
        checkTimeAndUpdateState();
        currentPollId = 1;
        _mint(msg.sender, 10000);
        product = _product;
    }

    function commitVote(uint pollId, bytes32 secretHash) external {
        checkTimeAndUpdateState();
        require(period == PeriodType.Commit);
        require(pollId == currentPollId);
        Poll storage poll = polls[pollId];
        require(secretHash != 0);

        // Allow vote rewrites.
        poll.committedVotes[msg.sender] = secretHash;
    }

    function revealVote(uint pollId, bool voteOption, uint salt) external {
        checkTimeAndUpdateState();
        require(period == PeriodType.Reveal);
        require(pollId == currentPollId);

        Poll storage poll = polls[pollId];

        bytes32 secretHash = poll.committedVotes[msg.sender];
        require(secretHash != 0);
        require(keccak256(abi.encodePacked(voteOption, salt)) == secretHash);

        // TODO(mrice32): add snapshotting to prevent using the same tokens to vote.
        uint userBalance = balanceOf(msg.sender);
        if (voteOption) {
            poll.votesFor += userBalance;
        } else {
            poll.votesAgainst += userBalance;
        }

        delete poll.committedVotes[msg.sender];
    }

    function getCurrentCommitRevealPeriods() external view returns (Period commit, Period reveal) {
        commit.startTime = currentPollStartTime;
        commit.endTime = currentPollStartTime + SECONDS_PER_THREE_DAYS;
        reveal.startTime = commit.endTime;
        reveal.endTime = currentPollStartTime + SECONDS_PER_WEEK;
    }

    function getCurrentPeriodType() external view returns (string periodType) {
        PeriodType currentPeriod = period;
        if (currentPeriod == PeriodType.Commit) {
            return "commit";
        } else if (currentPeriod == PeriodType.Reveal) {
            return "reveal";
        } else {
            assert(false);
        }
    }

    function getProduct() external view returns (string _product) {
        return product;
    }

    function getProposal(uint) external view returns (PriceTime[] prices) {
        prices = new PriceTime[](0);
    }

    function getProposedPriceAtTime(uint, uint) external view returns (int256 price) {
        return 0;
    }

    function getCommittedVoteForUser(uint pollId, address voter) external view returns (bytes32 secretHash) {         
        require(getActivePoll() == pollId);
        Poll storage poll = polls[pollId];
        secretHash = poll.committedVotes[voter];
        require(secretHash != 0);
    }

    function checkTimeAndUpdateState() public {
        uint time = now; // solhint-disable-line not-rely-on-time
        uint computedStartTime = getStartOfPeriod(time);

        if (computedStartTime != currentPollStartTime) {
            currentPollStartTime = computedStartTime;
            // TODO(mrice32): commit poll results here.
            ++currentPollId;
        }

        // TODO(mrice32): make this better on gas by only writing if the value changed.
        if (time >= computedStartTime + SECONDS_PER_THREE_DAYS) {
            period = PeriodType.Reveal;
        } else {
            period = PeriodType.Commit;
        }
    }

    function getActivePoll() public view returns (uint pollId) {
        // solhint-disable-next-line not-rely-on-time
        return getStartOfPeriod(now) != currentPollStartTime ? currentPollId + 1 : currentPollId;
    }

    function getStartOfPeriod(uint timestamp) private pure returns (uint) {
        return (((timestamp
            - MONDAY_EPOCH_EST_OFFSET)
            / SECONDS_PER_WEEK
            * SECONDS_PER_WEEK)
            + MONDAY_EPOCH_EST_OFFSET);
    }
}
