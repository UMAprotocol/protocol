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


library PriceTimeArray {
    using SafeMath for uint;
    using PriceTimeArray for PriceTime.Data[];

    function _mergeArray(PriceTime.Data[] storage self, PriceTime.Data[] memory mergingArray, uint interval) internal {
        require(mergingArray.length > 0);
        uint index = self._getIndex(mergingArray[0].time, interval);

        uint currentLength = self.length;

        for (uint i = 0; i < mergingArray.length; ++i) {
            // TODO(mrice32): we can break this into two loops to save the branch once we've passed the end of
            // the existing array.
            uint storageIndex = i.add(index);
            require(i == 0
                || mergingArray[i.sub(1)].time.add(interval) == mergingArray[i].time);
            assert(storageIndex <= currentLength);
            if (storageIndex == currentLength) {
                currentLength = self.push(mergingArray[i]);
            } else {
                self[storageIndex] = mergingArray[i];
            }
        }
    }

    function _appendArray(PriceTime.Data[] storage self, PriceTime[] memory mergingArray, uint interval) internal {
        require(self.getIndex(mergingArray[0].time, interval) == self.length);
        self._mergeArray(mergingArray, interval);
    }

    function _getIndex(PriceTime.Data[] storage self, uint time, uint interval) internal returns (uint idx) {
        require(time.mod(interval) == 0);
        if (self.length == 0) {
            idx = 0;
        } else {
            uint timeDiff = time.sub(self[0].time);
            idx = timeDiff.div(interval);
            require(idx <= self.length);
        }
    }
}


library Proposal {
    struct Data {
        uint numVotes;
        string ipfsHash;
    }
}


library Poll {
    struct Data {
        Proposal.Data[] proposals;
        uint totalVotes;
        uint currentLeader;
        mapping(address => bytes32) committedVotes;
    }

    function _initPrimary(Data storage self) internal {
        // Primary should have 2 proposals (no and yes).
        self.proposals.length = 2;
        self.currentLeader = 1;
        require(self.totalVotes == 0);
    }

    function _initRunoff(Data storage self) internal {
        require(self.proposals.length == 0);
        require(self.proposals.currentLeader == 0);
        require(self.totalVotes == 0);
    }

    function _commitVote(Data storage self, bytes32 secretHash) internal {
        require(secretHash != 0);

        // Allow vote rewrites.
        self.committedVotes[msg.sender] = secretHash;
    }

    function _revealVote(Data storage self, uint voteOption, uint salt, uint userBalance) internal {
        require(voteOption < self.proposals.length);

        bytes32 secretHash = self.committedVotes[msg.sender];
        require(secretHash != 0);
        require(keccak256(abi.encodePacked(voteOption, salt)) == secretHash);

        self.totalVotes = self.totalVotes.add(userBalance);

        // Incremental max: tiebreaker goes to the first proposal to reach the value.
        Proposal.Data storage proposal = self.proposals[voteOption];
        proposal.numVotes = proposal.numVotes.add(userBalance);
        if (proposal.numVotes > self.proposals[self.currentLeader].numVotes) {
            self.currentLeader = voteOption;
        }

        delete self.committedVotes[msg.sender];
    }

    function _addProposal(Data storage self, string ipfsHash) internal {
        uint idx = self.proposals.length++;
        self.proposals[idx].ipfsHash = ipfsHash;
    }

    function _getCommittedVote(Data storage self, address voter) internal view returns (bytes32 secretHash) {
        secretHash = self.committedVotes[voter];
        require(secretHash != 0);
    }
}


library VotePeriod {
    using SafeMath for uint;
    using Poll for Poll.Data;
    using VotePeriod for PriceTime[];

    enum PeriodType {
        Commit,
        Reveal,
        RunoffCommit,
        RunoffReveal,
        Wait
    }

    struct Data {
        uint startTime;
        Poll.Data primaryPoll;
        Poll.Data runoffPoll;

        // Note: the following two fields will only be needed in a runoff vote.
        // Stores the uploaded prices intended to overwrite the unverifiedPrice feed.
        PriceTime[] uploadedPriceTime;

        // Set to prevent the same IPFS hash from being proposed twice.
        mapping(string => bool) ipfsHashSet;
    }

    function _proposeFeed(Data storage self, string ipfsHash) internal {
        require(!self.ipfsHashSet[ipfsHash]);
        self.ipfsHashSet[ipfsHash] = true;
        self.runoffPoll._addProposal(ipfsHash);
    }

    function _init(Data storage self, uint startTime) internal {
        self.startTime = startTime;
        self.primaryPoll._initPrimary();
        self.runoffPoll._initRunoff();
    }

    function _commitVote(Data storage self, bytes32 secretHash, PeriodType period) internal {
        _getVotingPoll(period)._commitVote(secretHash);
    }

    function _revealVote(Data storage self, uint voteOption, uint salt, uint userBalance, PeriodType period) internal {
        _getVotingPoll(period)._revealVote(voteOption, salt, userBalance);
    }

    function _getVotingPoll(Data storage self, PeriodType period) internal returns (Poll.Data storage poll) {
        return (period == PeriodType.RunoffCommit || period == PeriodType.RunoffReveal
            ? self.runoffPoll : self.primaryPoll);
    }

    function _uploadPrices(Data storage self, PriceTime[] memory uploadArray, uint interval) internal {
        require(self._skipRunoff);
        self.uploadedPriceTime._mergeArray(uploadArray, interval);
    }

    function _getVotingPeriod(Data storage self, uint voteDuration)
        internal
        view
        returns (uint startTime, uint endTime)
    {
        return (self.startTime, self.startTime.add(voteDuration));
    }

    function _getPricePeriod(Data storage self, uint voteDuration)
        internal
        view
        returns (uint startTime, uint endTime)
    {
        return (self.startTime.sub(voteDuration), self.startTime);
    }

    function _skipRunoff(Data storage self) internal view returns (bool skipRunoff) {
        return self.primaryPoll.currentLeader == 1;
    }
}


contract VoteCoin is ERC20, VoteInterface, OracleInterface, Ownable {

    // Note: SafeMath only works for uints right now.
    using SafeMath for uint;
    using VotePeriod for VotePeriod.Data;
    using Poll for Poll.Data;
    using PriceTimeArray for PriceTime[];

    uint public currentVotePeriodIndex;

    string public product;

    PriceTime[] public unverifiedPrices;
    uint public firstUnverifiedIndex;
    uint public priceInterval;

    VotePeriod.PeriodType private period;

    VotePeriod.Data[] private votePeriods;

    uint private constant SECONDS_PER_WEEK = 604800;
    uint private constant MONDAY_EPOCH_EST_OFFSET = 327600;
    uint private constant SECONDS_PER_DAY = 86400;

    uint private epochOffset;
    uint private totalVotingDuration;

    struct PeriodTiming {
        uint startOffset;
        uint endOffset;
        VotePeriod.PeriodType state;
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
        (periodTimings[index++], startOffset) = _initPeriodTiming(startOffset, commitDuration,
            VotePeriod.PeriodType.Commit);
        (periodTimings[index++], startOffset) = _initPeriodTiming(startOffset, revealDuration,
            VotePeriod.PeriodType.Reveal);
        (periodTimings[index++], startOffset) = _initPeriodTiming(startOffset, runoffCommitDuration,
            VotePeriod.PeriodType.RunoffCommit);
        (periodTimings[index++], startOffset) = _initPeriodTiming(startOffset, runoffRevealDuration,
            VotePeriod.PeriodType.RunoffReveal);
        (periodTimings[index++], startOffset) = _initPeriodTiming(startOffset, totalVotingDuration.sub(startOffset),
            VotePeriod.PeriodType.Wait);

        // Ensure that voting periods start and end exactly on price publishing points to establish predictable price
        // stream sizes and start points.
        // solhint-disable-next-line not-rely-on-time
        require(_getStartOfPeriod(now).mod(_priceInterval) == 0 && totalVotingDuration.mod(_priceInterval) == 0);

        currentVotePeriodIndex = _newVotePeriod(_getStartOfPeriod(now));

        checkTimeAndUpdateState();
    }

    function commitVote(bytes32 secretHash) external {
        checkTimeAndUpdateState();
        require(period == VotePeriod.PeriodType.Commit || period == VotePeriod.PeriodType.RunoffCommit);

        _getCurrentVotePeriod()._commitVote(secretHash, period);
    }

    // TODO(mrice32): maybe we should force the user to encode the proposal IPFS hash into their secretHash rather than
    // the index of the option to be sure they're aware of what they're voting for.
    function revealVote(uint voteOption, uint salt) external {
        checkTimeAndUpdateState();
        require(period == VotePeriod.PeriodType.Reveal || period == VotePeriod.PeriodType.RunoffReveal);

        // TODO(mrice32): add snapshotting here.
        _getCurrentVotePeriod()._revealVote(voteOption, salt, balanceOf(msg.sender), period);
    }

    function proposeFeed(string ipfsHash) external {
        checkTimeAndUpdateState();
        require(period == VotePeriod.PeriodType.Commit || period == VotePeriod.PeriodType.Reveal);

        _getCurrentVotePeriod()._proposeFeed(ipfsHash);
    }

    function addUnverifiedPrice(PriceTime.Data priceTime) external {
        PriceTime[] memory priceTimes = new PriceTime[](1);
        priceTimes[0] = priceTime;
        addUnverifiedPrices(priceTimes);
    }

    function uploadVerifiedPrices(PriceTime[] priceTimes) external onlyOwner {
        require(priceTimes.length > 0);
        uint voteIdx = _getVotePeriodIndexForStartTime(_getStartOfPeriod(priceTimes[0].time)).sub(1);
        require(voteIdx == _getVotePeriodIndexForStartTime(unverifiedPrices[firstUnverifiedIndex].time));
        VotePeriod.Data storage votePeriod = votePeriods[voteIdx];
        require(currentVotePeriodIndex != voteIdx || period == VotePeriod.VotePeriod.PeriodType.Wait);

        votePeriod._uploadPrices(priceTimes, priceInterval);
    }

    function getProposals() external view returns (Proposal[] proposals) {
        uint time = now;
        uint computedStartTime = _getStartOfPeriod(time);

        VotePeriod.Data storage votePeriod = _getCurrentVotePeriod();
        if (computedStartTime == votePeriod.startTime) {
            Poll.Data storage poll = votePeriod.runoffPoll;
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
        VotePeriod.Data storage votePeriod = _getCurrentVotePeriod();
        (uint startTime, uint endTime) = votePeriod._getPricePeriod();
        uint startIndex = unverifiedPrices._getIndex(startTime);

        // Note: endIndex is non-inclusive.
        uint endIndex = unverifiedPrices._getIndex(endTime);

        prices = new PriceTime[](endIndex.sub(startIndex));
        for (uint i = startIndex; i < endIndex; ++i) {
            prices[i.sub(startIndex)] = unverifiedPrices[i];
        }
    }

    function getDefaultProposedPriceAtTime(uint time) external view returns (int256 price) {
        VotePeriod.Data storage votePeriod = _getCurrentVotePeriod();
        (uint startTime, uint endTime) = votePeriod._getPricePeriod();
        require(time >= startTime && time < endTime);
        uint index = unverifiedPrices._getIndex(time);
        require(index < unverifiedPrices.length);

        return unverifiedPrices[index].price;
    }

    function getCommittedVoteForUser(address voter) external view returns (bytes32 secretHash) {
        require(period == VotePeriod.PeriodType.Commit
            || period == VotePeriod.PeriodType.Reveal
            || period == VotePeriod.PeriodType.RunoffCommit
            || period == VotePeriod.PeriodType.RunoffReveal);

        return _getCurrentVotePeriod()._getVotingPoll(period)._getCommittedVote(voter);
    }

    function addUnverifiedPrices(PriceTime[] memory priceTimes) public onlyOwner {
        unverifiedPrices._mergeArray(priceTimes);
    }

    function checkTimeAndUpdateState() public {
        uint time = now; // solhint-disable-line not-rely-on-time
        uint computedStartTime = _getStartOfPeriod(time);

        VotePeriod.PeriodType newPeriod = _getPeriodType(computedStartTime, time);

        VotePeriod.Data storage currentVotePeriod = _getCurrentVotePeriod();

        bool shouldCommitPrices = false;

        if (computedStartTime != currentVotePeriod.startTime) {
            shouldCommitPrices = true;

            _newVotePeriod(computedStartTime);
        }

        if (period != newPeriod) {
            if (newPeriod == VotePeriod.PeriodType.Wait && currentVotePeriod._skipRunoff()) {
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

    function _getStringPeriodType(VotePeriod.PeriodType periodType) private pure returns (string stringPeriodType) {
        if (periodType == VotePeriod.PeriodType.Commit) {
            return "commit";
        } else if (periodType == VotePeriod.PeriodType.Reveal) {
            return "reveal";
        } else if (periodType == VotePeriod.PeriodType.RunoffCommit) {
            return "runoff commit";
        } else if (periodType == VotePeriod.PeriodType.RunoffReveal) {
            return "runoff reveal";
        } else if (periodType == VotePeriod.PeriodType.Wait) {
            return "wait";
        } else {
            assert(false);
        }
    }

    function _initPeriodTiming(uint startOffset, uint duration, VotePeriod.PeriodType periodType)
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

    function _getPeriodType(uint votePeriodStartTime, uint currentTime) private view returns (VotePeriod.PeriodType periodType) {
        for (uint i = 0; i < periodTimings.length; ++i) {
            if (periodTimings[i].startOffset.add(votePeriodStartTime) <= currentTime
                && currentTime < periodTimings[i].endOffset.add(votePeriodStartTime)) {
                periodType = periodTimings[i].state;
                if ((periodType == VotePeriod.PeriodType.RunoffCommit || periodType == VotePeriod.PeriodType.RunoffReveal)
                    && _getCurrentVotePeriod()._skipRunoff()) {
                    periodType = VotePeriod.PeriodType.Wait;
                }
                return periodType;
            }
        }

        assert(false);
    }

    function _newVotePeriod(uint startTime) private returns (VotePeriod.Data storage votePeriod) {
        currentVotePeriodIndex = votePeriods.length++;
        votePeriod = votePeriods[currentVotePeriodIndex];
        votePeriod._init(startTime);
    }

    function _commitPrices(VotePeriod.PeriodType newPeriodType, uint newVoteIndex) private {
        uint lastVerifiedTime = unverifiedPrices[firstUnverifiedIndex].time;
        uint idxLimit = votePeriods.length;

        if (newPeriodType != VotePeriod.PeriodType.Wait) {
            idxLimit = newVoteIndex;
        }

        uint newFirstUnverifiedIndex = firstUnverifiedIndex;

        for (uint idx = _getVotePeriodIndexForStartTime(lastVerifiedTime); idx < idxLimit; ++idx) {
            VotePeriod.Data storage votePeriod = votePeriods[idx];
            if (votePeriod._skipRunoff()) {
                newFirstUnverifiedIndex = unverifiedPrices._getIndex(votePeriod.startTime);
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

    function _getCurrentVotePeriod() private view returns (VotePeriod.Data storage votePeriod) {
        return votePeriods[currentVotePeriodIndex];
    }
}
