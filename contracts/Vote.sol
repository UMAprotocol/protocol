/*
  VoteCoin implementation

  Implements an early version of VoteCoin protocols

  * ERC20 token
  * Uses Oraclize to fetch ETH/USD exchange rate
  * Allows users to vote yes/no on whether a price is accurate

*/
pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "./Testable.sol";
import "./Derivative.sol";
import "./VoteInterface.sol";
import "./OracleInterface.sol";


library Poll {
    using SafeMath for uint;
    using Poll for Data;

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
        self.totalVotes = 0;
    }

    function _initRunoff(Data storage self) internal {
        self.proposals.length = 0;
        self.currentLeader = 0;
        self.totalVotes = 0;
        // TODO(mrice32): replace this with a real hash once it's added.
        // Initial proposal is the existing price feed.
        self._addProposal("QmWWQSuPMS6aXCbZKpEjPHPUZN2NjB3YrhJTHsV4X3vb2t");
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
        delete self.committedVotes[msg.sender];

        self.totalVotes = self.totalVotes.add(userBalance);

        // Incremental max: tiebreaker goes to the first proposal to reach the value.
        Proposal.Data storage proposal = self.proposals[voteOption];
        proposal.numVotes = proposal.numVotes.add(userBalance);
        if (proposal.numVotes > self.proposals[self.currentLeader].numVotes) {
            self.currentLeader = voteOption;
        }
    }

    function _addProposal(Data storage self, string memory ipfsHash) internal {
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
    using PriceTime for PriceTime.Data[];
    using VotePeriod for Data;

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

        // Set to prevent the same IPFS hash from being proposed twice.
        mapping(string => bool) ipfsHashSet;
    }

    function _proposeFeed(Data storage self, string memory ipfsHash) internal {
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
        self._getVotingPoll(period)._commitVote(secretHash);
    }

    function _revealVote(Data storage self, uint voteOption, uint salt, uint userBalance, PeriodType period) internal {
        self._getVotingPoll(period)._revealVote(voteOption, salt, userBalance);
    }

    function _getVotingPoll(Data storage self, PeriodType period) internal view returns (Poll.Data storage poll) {
        return (period == PeriodType.RunoffCommit || period == PeriodType.RunoffReveal
            ? self.runoffPoll : self.primaryPoll);
    }

    function _verifyPrices(
        Data storage self,
        PriceTime.Data[] storage unverifiedPrices,
        uint interval,
        uint voteDuration
    )
        internal
        view
        returns (bool success, uint newFirstUnverifiedIndex)
    {
        require(!self._skipRunoff());
        (uint startTime, uint endTime) = self._getPricePeriod(voteDuration);

        uint startIndex = unverifiedPrices._getIndex(startTime, interval);
        uint endIndex = unverifiedPrices._getIndex(endTime, interval);

        require(startIndex <= endIndex);
        
        // TODO(mrice32): do ipfs hash verification here and make use of startIndex and endIndex.
        return (true, endIndex);
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


contract VoteCoin is ERC20, VoteInterface, OracleInterface, Testable {

    // Note: SafeMath only works for uints right     using SafeMath for uint;
    using VotePeriod for VotePeriod.Data;
    using Poll for Poll.Data;
    using PriceTime for PriceTime.Data[];

    uint public currentVotePeriodIndex;

    string public product;

    PriceTime.Data[] public unverifiedPrices;
    uint public firstUnverifiedIndex;
    uint public priceInterval;

    VotePeriod.PeriodType private period;

    VotePeriod.Data[] private votePeriods;

    uint private constant SECONDS_PER_WEEK = 604800;
    // uint private constant MONDAY_EPOCH_EST_OFFSET = 327600;
    uint private constant MONDAY_EPOCH_EST_OFFSET = 345600;
    uint private constant SECONDS_PER_DAY = 86400;

    uint private epochOffset;
    uint private totalVotingDuration;

    struct PeriodTiming {
        uint startOffset;
        uint endOffset;
        VotePeriod.PeriodType state;
    }

    PeriodTiming[5] private periodTimings;

    constructor(string memory _product, uint _priceInterval, bool isTest) public Testable(isTest) {
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

        uint time = getCurrentTime();

        // Ensure that voting periods start and end exactly on price publishing points to establish predictable price
        // stream sizes and start points.
        require(_getStartOfPeriod(time).mod(_priceInterval) == 0 && totalVotingDuration.mod(_priceInterval) == 0);

        _newVotePeriod(_getStartOfPeriod(time));

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

    function proposeFeed(string calldata ipfsHash) external {
        checkTimeAndUpdateState();
        require(period == VotePeriod.PeriodType.Commit || period == VotePeriod.PeriodType.Reveal);

        _getCurrentVotePeriod()._proposeFeed(ipfsHash);
    }

    function validatePrices() external {
        require(unverifiedPrices.length > firstUnverifiedIndex);
        checkTimeAndUpdateState();
        uint idx = _getVotePeriodIndexForPriceTime(unverifiedPrices[firstUnverifiedIndex].time);
        VotePeriod.Data storage votePeriod = votePeriods[idx];
        if (votePeriod._skipRunoff()) {
            _commitPrices(period, currentVotePeriodIndex);
        } else {
            (bool success, uint newFirstUnverifiedIndex) = votePeriod._verifyPrices(
                unverifiedPrices,
                priceInterval,
                totalVotingDuration
            );

            firstUnverifiedIndex = newFirstUnverifiedIndex;

            require(success);
        }
    }

    function getProposals() external view returns (Proposal.Data[] memory proposals) {
        uint time = getCurrentTime();
        uint computedStartTime = _getStartOfPeriod(time);

        VotePeriod.Data storage votePeriod = _getCurrentVotePeriod();
        if (computedStartTime == votePeriod.startTime) {
            Poll.Data storage poll = votePeriod.runoffPoll;
            proposals = poll.proposals;
        } else {
            return new Proposal.Data[](0);
        }
    }

    function getCurrentCommitRevealPeriods() external view returns (Period[] memory periods) {
        uint startOfPeriod = _getStartOfPeriod(getCurrentTime());
        periods = new Period[](periodTimings.length);
        for (uint i = 0; i < periodTimings.length; ++i) {
            Period memory timePeriod = periods[i];
            PeriodTiming storage periodTiming = periodTimings[i];
            timePeriod.startTime = periodTiming.startOffset.add(startOfPeriod);
            timePeriod.endTime = periodTiming.endOffset.add(startOfPeriod);
            timePeriod.state = _getStringPeriodType(periodTiming.state);
        }
    }

    function getCurrentPeriodType() external view returns (string memory periodType) {
        uint currentTime = getCurrentTime();
        return _getStringPeriodType(_getPeriodType(_getStartOfPeriod(currentTime), currentTime));
    }

    function getProduct() external view returns (string memory _product) {
        return product;
    }

    function getDefaultProposalPrices() external view returns (PriceTime.Data[] memory prices) {
        // TODO(mrice32): we may want to subtract some time offset to ensure all unverifiedPrices being voted on are
        // in before the voting period starts.
        // Note: this will fail if the entire voting period of prices previous do not exist.
        VotePeriod.Data storage votePeriod = _getCurrentVotePeriod();
        (uint startTime, uint endTime) = votePeriod._getPricePeriod(totalVotingDuration);
        if (unverifiedPrices.length == 0 || startTime < unverifiedPrices[0].time) {
            return prices;
        }
        uint startIndex = unverifiedPrices._getIndex(startTime, priceInterval);

        // Note: endIndex is non-inclusive.
        uint endIndex = unverifiedPrices._getIndex(endTime, priceInterval);

        prices = new PriceTime.Data[](endIndex.sub(startIndex));
        for (uint i = startIndex; i < endIndex; ++i) {
            prices[i.sub(startIndex)] = unverifiedPrices[i];
        }
    }

    function getDefaultProposedPriceAtTime(uint time) external view returns (int256 price) {
        VotePeriod.Data storage votePeriod = _getCurrentVotePeriod();
        (uint startTime, uint endTime) = votePeriod._getPricePeriod(totalVotingDuration);
        require(time >= startTime && time < endTime);
        uint index = unverifiedPrices._getIndex(time, priceInterval);
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

    function latestUnverifiedPrice() external view returns (uint publishTime, int256 price) {
        uint currentLength = unverifiedPrices.length;
        if (currentLength == 0) {
            return (0, 0);
        }

        PriceTime.Data storage priceTime = unverifiedPrices[currentLength.sub(1)];
        return (priceTime.time, priceTime.price);
    }

    function latestVerifiedPrice() external view returns (uint publishTime, int256 price) {
        if (firstUnverifiedIndex == 0) {
            return (0, 0);
        }

        uint lastVerifiedIndex = firstUnverifiedIndex.sub(1);
        PriceTime.Data storage priceTime = unverifiedPrices[lastVerifiedIndex];
        return (priceTime.time, priceTime.price);
    }

    function unverifiedPrice(uint time) external view returns (uint publishTime, int256 price) {
        return unverifiedPrices._getBestPriceTimeForTime(time, unverifiedPrices.length, priceInterval);
    }

    function verifiedPrice(uint time) external view returns (uint publishTime, int256 price) {
        return unverifiedPrices._getBestPriceTimeForTime(time, firstUnverifiedIndex, priceInterval);
    }

    function computeHash(uint voteOption, uint salt) external pure returns (bytes32 hash) {
        return keccak256(abi.encodePacked(voteOption, salt));
    }

    // Note: this method cannot be external because solidity has not implemented structs being passed into external
    // functions (triggers a difficult to diagnose compiler error).
    function addUnverifiedPrice(PriceTime.Data memory priceTime) public {
        PriceTime.Data[] memory priceTimes = new PriceTime.Data[](1);
        priceTimes[0] = priceTime;
        addUnverifiedPrices(priceTimes);
    }

    function addUnverifiedPrices(PriceTime.Data[] memory priceTimes) public onlyOwner {
        require(priceTimes.length > 0);
        checkTimeAndUpdateState();

        uint currentLength = unverifiedPrices.length;

        // We don't need to do any checks if we're appending to the end - this is always allowed.
        if (currentLength != 0 && unverifiedPrices[currentLength - 1].time >= priceTimes[0].time) {

            // Verified prices cannot be changed.
            require(unverifiedPrices._getIndex(priceTimes[0].time, priceInterval) >= firstUnverifiedIndex);


            uint startVotePeriod = _getVotePeriodIndexForStartTime(priceTimes[0].time);
            uint endVotePeriod = _getVotePeriodIndexForStartTime(priceTimes[priceTimes.length.sub(1)].time);
            for (uint i = startVotePeriod; i <= endVotePeriod; ++i) {
                if (i <= currentVotePeriodIndex) {
                    // Must be trying to change the prices to the winner of the price feed.
                    require(!votePeriods[i]._skipRunoff());

                    if (i == currentVotePeriodIndex) {
                        // If this is the current vote period, ensure that we're in the wait portion
                        require(period == VotePeriod.PeriodType.Wait);
                    }
                }
            }

        }


        unverifiedPrices._mergeArray(priceTimes, priceInterval);
    }

    function checkTimeAndUpdateState() public {
        uint time = getCurrentTime();
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

    function _getStringPeriodType(VotePeriod.PeriodType periodType)
        private
        pure
        returns (string memory stringPeriodType)
    {
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
        returns (PeriodTiming memory periodTiming, uint nextStartOffset)
    {
        periodTiming.startOffset = startOffset;
        periodTiming.endOffset = startOffset.add(duration);
        require(periodTiming.endOffset <= totalVotingDuration);
        periodTiming.state = periodType;
        nextStartOffset = periodTiming.endOffset;
    }

    function _getPeriodType(uint votePeriodStartTime, uint currentTime)
        private
        view
        returns (VotePeriod.PeriodType periodType)
    {
        for (uint i = 0; i < periodTimings.length; ++i) {
            if (periodTimings[i].startOffset.add(votePeriodStartTime) <= currentTime
                && currentTime < periodTimings[i].endOffset.add(votePeriodStartTime)) {
                periodType = periodTimings[i].state;
                if ((periodType == VotePeriod.PeriodType.RunoffCommit
                    || periodType == VotePeriod.PeriodType.RunoffReveal)
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
        uint startIdx = 0;
        if (firstUnverifiedIndex != 0) {
            uint firstUnverifiedTime = unverifiedPrices[firstUnverifiedIndex].time;
            startIdx = _getVotePeriodIndexForPriceTime(firstUnverifiedTime);
        }

        uint endIdx = votePeriods.length;
        if (newPeriodType != VotePeriod.PeriodType.Wait) {
            endIdx = newVoteIndex;
        }

        uint newFirstUnverifiedIndex = firstUnverifiedIndex;

        for (uint idx = startIdx; idx < endIdx; ++idx) {
            VotePeriod.Data storage votePeriod = votePeriods[idx];
            if (votePeriod._skipRunoff()) {
                (, uint endTime) = votePeriod._getPricePeriod(totalVotingDuration);
                newFirstUnverifiedIndex = unverifiedPrices._getIndex(endTime, priceInterval);
            } else {
                break;
            }
        }

        firstUnverifiedIndex = newFirstUnverifiedIndex;
    }

    function _getVotePeriodIndexForStartTime(uint startTime) private view returns (uint index) {
        uint currentLength = votePeriods.length;
        if (currentLength == 0) {
            index = 0;
        } else {
            index = startTime.sub(votePeriods[0].startTime).div(totalVotingDuration);
            require(index < currentLength);
        }
    }

    function _getCurrentVotePeriod() private view returns (VotePeriod.Data storage votePeriod) {
        return votePeriods[currentVotePeriodIndex];
    }

    function _getVotePeriodIndexForPriceTime(uint time) private view returns (uint index) {
        return _getVotePeriodIndexForStartTime(_getStartOfPeriod(time)).add(1);
    }
}
