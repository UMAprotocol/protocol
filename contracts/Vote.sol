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
        Reveal,
        RunoffCommit,
        RunoffReveal,
        Wait
    }

    uint public currentVotePeriodIndex;

    string public product;

    PriceTime[] public unverifiedPrices;
    uint public firstUnverifiedIndex;
    uint public priceInterval;

    PeriodType private period;

    struct Proposal {
        uint numVotes;
        string ipfsHash;
    }

    struct Poll {
        Proposal[] proposals;
        uint totalVotes;
        uint currentLeader;
        mapping(address => bytes32) committedVotes;
    }

    struct VotePeriod {
        uint startTime;
        Poll primaryPoll;
        Poll runoffPoll;

        // Note: the following two fields will only be needed in a runoff vote.
        // Stores the uploaded prices intended to overwrite the unverifiedPrice feed.
        PriceTime[] uploadedPriceTime;

        // Set to prevent the same IPFS hash from being proposed twice.
        mapping(string => bool) ipfsHashSet;
    }

    VotePeriod[] private votePeriods;

    uint private constant SECONDS_PER_WEEK = 604800;
    uint private constant MONDAY_EPOCH_EST_OFFSET = 327600;
    uint private constant SECONDS_PER_DAY = 86400;

    uint private epochOffset;
    uint private totalVotingDuration;

    struct PeriodTiming {
        uint startOffset;
        uint endOffset;
        PeriodType state;
    }

    PeriodTiming[5] private periodTimings;

    constructor(string _product, uint _priceInterval) public {
        _mint(msg.sender, 10000);
        product = _product;
        priceInterval = _priceInterval;
        
        // TODO(mrice32): make these input variables.
        uint commitDuration = SECONDS_PER_DAY;
        uint revealDuration = SECONDS_PER_DAY;
        uint runoffCommitDuration = SECONDS_PER_DAY;
        uint runoffRevealDuration = SECONDS_PER_DAY;

        epochOffset = MONDAY_EPOCH_EST_OFFSET;
        totalVotingDuration = SECONDS_PER_WEEK;

        uint index = 0;
        uint startOffset = 0;
        (periodTimings[index++], startOffset) = _initPeriodTiming(startOffset, commitDuration, PeriodType.Commit);
        (periodTimings[index++], startOffset) = _initPeriodTiming(startOffset, revealDuration, PeriodType.Reveal);
        (periodTimings[index++], startOffset) = _initPeriodTiming(startOffset, runoffCommitDuration,
            PeriodType.RunoffCommit);
        (periodTimings[index++], startOffset) = _initPeriodTiming(startOffset, runoffRevealDuration,
            PeriodType.RunoffReveal);
        (periodTimings[index++], startOffset) = _initPeriodTiming(startOffset, totalVotingDuration.sub(startOffset),
            PeriodType.Wait);

        // Ensure that voting periods start and end exactly on price publishing points to establish predictable price
        // stream sizes and start points.
        // solhint-disable-next-line not-rely-on-time
        require(_getStartOfPeriod(now).mod(_priceInterval) == 0 && totalVotingDuration.mod(_priceInterval) == 0);

        currentVotePeriodIndex = _newVotePeriod();

        checkTimeAndUpdateState();
    }

    function commitVote(bytes32 secretHash) external {
        checkTimeAndUpdateState();
        require(period == PeriodType.Commit || period == PeriodType.RunoffCommit);

        Poll storage poll = _getVotingPoll();
        require(secretHash != 0);

        // Allow vote rewrites.
        poll.committedVotes[msg.sender] = secretHash;
    }

    // TODO(mrice32): maybe we should force the user to encode the proposal IPFS hash into their secretHash rather than
    // the index of the option to be sure they're aware of what they're voting for.
    function revealVote(uint voteOption, uint salt) external {
        checkTimeAndUpdateState();
        require(period == PeriodType.Reveal || period == PeriodType.RunoffReveal);

        Poll storage poll = _getVotingPoll();

        require(voteOption < poll.proposals.length);

        bytes32 secretHash = poll.committedVotes[msg.sender];
        require(secretHash != 0);
        require(keccak256(abi.encodePacked(voteOption, salt)) == secretHash);

        // TODO(mrice32): add snapshotting to prevent using the same tokens to vote.
        uint userBalance = balanceOf(msg.sender);

        // Incremental max: tiebreaker goes to the first proposal to reach the value.
        Proposal storage proposal = poll.proposals[voteOption];
        proposal.numVotes = proposal.numVotes.add(userBalance);
        if (proposal.numVotes > poll.proposals[poll.currentLeader].numVotes) {
            poll.currentLeader = voteOption;
        }

        delete poll.committedVotes[msg.sender];
    }

    function proposeFeed(string ipfsHash) external {
        checkTimeAndUpdateState();
        require(period == PeriodType.Commit || period == PeriodType.Reveal);
        VotePeriod storage votePeriod = votePeriods[currentVotePeriodIndex];

        // Prevent same hash from being proposed twice.
        require(!votePeriod.ipfsHashSet[ipfsHash]);
        votePeriod.ipfsHashSet[ipfsHash] = true;

        Poll storage runoffPoll = votePeriod.runoffPoll;
        Proposal memory proposal;
        proposal.ipfsHash = ipfsHash;
        runoffPoll.proposals.push(proposal);
    }

    function addUnverifiedPrice(PriceTime priceTime) external {
        PriceTime[] memory priceTimes = new PriceTime[](1);
        priceTimes[0] = priceTime;
        addUnverifiedPrices(priceTimes);
    }

    function getProposals() external view returns (Proposal[] proposals) {
        uint time = now;
        uint computedStartTime = _getStartOfPeriod(time);
        VotePeriod storage votePeriod = votePeriods[currentVotePeriodIndex];
        if (computedStartTime == votePeriod.startTime) {
            Poll storage poll = votePeriod.runoffPoll;
            proposals = poll.proposals;
        } else {
            return new Proposal[](0);
        }
    }

    function getCurrentCommitRevealPeriods() external view returns (Period[] memory periods) {
        uint startOfPeriod = _getStartOfPeriod(now); // solhint-disable-line not-rely-on-time
        periods = new Period[](periodTimings.length);
        for (uint i = 0; i < periodTimings.length; ++i) {
            Period memory timePeriod = periods[i];
            PeriodTiming storage periodTiming = periodTimings[i];
            timePeriod.startTime = periodTiming.startOffset.add(startOfPeriod);
            timePeriod.endTime = periodTiming.endOffset.add(startOfPeriod);
            timePeriod.state = _getStringPeriodType(periodTiming.state);
        }
    }

    function getCurrentPeriodType() external view returns (string periodType) {
        uint currentTime = now; // solhint-disable-line not-rely-on-time
        return _getStringPeriodType(_getPeriodType(_getStartOfPeriod(currentTime), currentTime));
    }

    function getProduct() external view returns (string _product) {
        return product;
    }

    function getDefaultProposalPrices() external view returns (PriceTime[] prices) {
        // TODO(mrice32): we may want to subtract some time offset to ensure all unverifiedPrices being voted on are
        // in before the voting period starts.
        // Note: this will fail if the entire voting period of prices previous do not exist.
        VotePeriod storage votePeriod = votePeriods[currentVotePeriodIndex];
        uint startIndex = _getPriceIndex(votePeriod.startTime.sub(totalVotingDuration));

        // Note: endIndex is non-inclusive.
        uint endIndex = _getPriceIndex(votePeriod.startTime);

        // All prices must be in before returning them.
        require(endIndex <= unverifiedPrices.length);

        prices = new PriceTime[](endIndex.sub(startIndex));

        for (uint i = startIndex; i < endIndex; ++i) {
            prices[i.sub(startIndex)] = unverifiedPrices[i];
        }
    }

    function getDefaultProposedPriceAtTime(uint time) external view returns (int256 price) {
        uint currentVotePeriodStartTime = votePeriods[currentVotePeriodIndex].startTime;
        require(time >= currentVotePeriodStartTime.sub(totalVotingDuration)
            && time < currentVotePeriodStartTime);
        uint index = _getPriceIndex(time);

        require(index < unverifiedPrices.length);

        return unverifiedPrices[index].price;
    }

    function getCommittedVoteForUser(address voter) external view returns (bytes32 secretHash) {
        require(period == PeriodType.Commit
            || period == PeriodType.Reveal
            || period == PeriodType.RunoffCommit
            || period == PeriodType.RunoffReveal);

        Poll storage poll = _getVotingPoll();
        secretHash = poll.committedVotes[voter];
        require(secretHash != 0);
    }

    function addUnverifiedPrices(PriceTime[] memory priceTimes) public onlyOwner {
        require(priceTimes.length >= 0);
        uint index = _getPriceIndex(priceTimes[0].time);
        require(index <= unverifiedPrices.length);

        for (uint i = 0; i < priceTimes.length; ++i) {
            // TODO(mrice32): we can break this into two loops to save the branch once we've passed the end of
            // the existing array.
            uint storageIndex = i.add(index);
            uint currentLength = unverifiedPrices.length;
            require(storageIndex == 0
                || unverifiedPrices[storageIndex.sub(1)].time.add(priceInterval) == priceTimes[i].time);
            assert(storageIndex <= currentLength);
            if (storageIndex == currentLength) {
                unverifiedPrices.push(priceTimes[i]);
            } else {
                unverifiedPrices[storageIndex] = priceTimes[i];
            }
        }
    }

    function checkTimeAndUpdateState() public {
        uint time = now; // solhint-disable-line not-rely-on-time
        uint computedStartTime = _getStartOfPeriod(time);

        PeriodType newPeriod = _getPeriodType(computedStartTime, time);

        VotePeriod storage currentVotePeriod = votePeriods[currentVotePeriodIndex];

        bool shouldCommitPrices = false;

        if (computedStartTime != currentVotePeriod.startTime) {
            shouldCommitPrices = true;

            currentVotePeriodIndex = _newVotePeriod();

            VotePeriod storage newVotePeriod = votePeriods[currentVotePeriodIndex];
            newVotePeriod.startTime = computedStartTime;

            Poll storage primaryPoll = newVotePeriod.primaryPoll;
            primaryPoll.proposals.length++;
            primaryPoll.proposals.length++;

            // One is the "yes" vote.
            primaryPoll.currentLeader = 1;
        }

        if (period != newPeriod) {
            if (newPeriod == PeriodType.Wait && _skipRunoff(currentVotePeriod)) {
                shouldCommitPrices = true;
            }
            period = newPeriod;
        }

        if (shouldCommitPrices) {
            _commitPrices(newPeriod, currentVotePeriodIndex);
        }

    }

    function _getStartOfPeriod(uint timestamp) private view returns (uint) {
        return timestamp.sub(epochOffset).div(totalVotingDuration).mul(totalVotingDuration).add(epochOffset);
    }

    function _getPriceIndex(uint timestamp) private view returns(uint index) {
        require(timestamp.mod(priceInterval) == 0);
        uint currentLength = unverifiedPrices.length;
        index = 0;
        if (currentLength != 0) {
            index = timestamp.sub(unverifiedPrices[0].time).div(priceInterval);
        }
    }

    function _getStringPeriodType(PeriodType periodType) private pure returns (string stringPeriodType) {
        if (periodType == PeriodType.Commit) {
            return "commit";
        } else if (periodType == PeriodType.Reveal) {
            return "reveal";
        } else if (periodType == PeriodType.RunoffCommit) {
            return "runoff commit";
        } else if (periodType == PeriodType.RunoffReveal) {
            return "runoff reveal";
        } else if (periodType == PeriodType.Wait) {
            return "wait";
        } else {
            assert(false);
        }
    }

    function _initPeriodTiming(uint startOffset, uint duration, PeriodType periodType)
        private
        view
        returns (PeriodTiming periodTiming, uint nextStartOffset)
    {
        periodTiming.startOffset = startOffset;
        periodTiming.endOffset = startOffset.add(duration);
        require(periodTiming.endOffset <= totalVotingDuration);
        periodTiming.state = periodType;
        nextStartOffset = periodTiming.endOffset;
    }

    function _getPeriodType(uint votePeriodStartTime, uint currentTime) private view returns (PeriodType periodType) {
        for (uint i = 0; i < periodTimings.length; ++i) {
            if (periodTimings[i].startOffset.add(votePeriodStartTime) <= currentTime
                && currentTime < periodTimings[i].endOffset.add(votePeriodStartTime)) {
                periodType = periodTimings[i].state;
                if ((periodType == PeriodType.RunoffCommit || periodType == PeriodType.RunoffReveal)
                    && _skipRunoff(votePeriods[currentVotePeriodIndex])) {
                    periodType = PeriodType.Wait;
                }
                return periodType;
            }
        }

        assert(false);
    }

    function _newVotePeriod() private returns (uint pollId) {
        // TODO(mrice32): this way of appending default initialized space to an array might be going out of favor.
        // We should move to something like what's being proposed: https://github.com/ethereum/solidity/issues/3572
        return votePeriods.length++;
    }

    function _getVotingPoll() private view returns (Poll storage activePoll) {
        VotePeriod storage votePeriod = votePeriods[currentVotePeriodIndex];
        return (period == PeriodType.RunoffCommit || period == PeriodType.RunoffReveal
            ? votePeriod.runoffPoll : votePeriod.primaryPoll);
    }

    function _commitPrices(PeriodType newPeriodType, uint newVoteIndex) private {
        uint lastVerifiedTime = unverifiedPrices[firstUnverifiedIndex].time;
        uint idxLimit = votePeriods.length;

        if (newPeriodType != PeriodType.Wait) {
            idxLimit = newVoteIndex;
        }

        uint newFirstUnverifiedIndex = firstUnverifiedIndex;

        for (uint idx = _getVotePeriodIndexForStartTime(lastVerifiedTime); idx < idxLimit; ++idx) {
            VotePeriod storage votePeriod = votePeriods[idx];
            if (_skipRunoff(votePeriod)) {
                newFirstUnverifiedIndex = _getPriceIndex(votePeriod.startTime);
            } else {
                break;
            }
        }

        firstUnverifiedIndex = newFirstUnverifiedIndex;
    }

    function _getVotePeriodIndexForStartTime(uint startTime) private view returns (uint index) {
        if (votePeriods.length == 0) {
            return 0;
        } else {
            return startTime.sub(votePeriods[0].startTime).div(totalVotingDuration);
        }
    }

    function _skipRunoff(VotePeriod storage votePeriod) private view returns (bool skipRunoff) {
        return votePeriod.primaryPoll.currentLeader == 1;
    }
}
