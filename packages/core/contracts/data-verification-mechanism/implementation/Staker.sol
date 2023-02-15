// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/MultiCaller.sol";

import "../../common/interfaces/ExpandedIERC20.sol";
import "../interfaces/StakerInterface.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title Staking contract enabling UMA to be locked up by stakers to earn a pro rata share of a fixed emission rate.
 * @dev Handles the staking, unstaking and reward retrieval logic.
 */
abstract contract Staker is StakerInterface, Ownable, Lockable, MultiCaller {
    /****************************************
     *             STAKING STATE            *
     ****************************************/

    // Identifies a "stake" for a given voter. Each staker has an instance of this struct.
    struct VoterStake {
        uint128 stake; // UMA staked by the staker.
        uint128 pendingUnstake; // UMA in unstake cooldown period, waiting to be unstaked.
        mapping(uint32 => uint128) pendingStakes; // If a voter stakes during an active reveal, stake is pending.
        uint128 rewardsPaidPerToken; // Internal tracker used in the calculation of pro-rata share of rewards.
        uint128 outstandingRewards; // Accumulated rewards that have not yet been claimed.
        int128 unappliedSlash; // Used to track unapplied slashing in the case of bisected rounds.
        uint64 nextIndexToProcess; // The next request index that a staker is susceptible to be slashed on.
        uint64 unstakeTime; // Time that a staker can unstake. Used to determine if cooldown has passed.
        address delegate; // Address a staker has delegated to. The delegate can commit/reveal/claimRestake rewards.
    }

    mapping(address => VoterStake) public voterStakes; // Each voter is mapped to staker struct for their position.

    mapping(address => address) public delegateToStaker; // Mapping of delegates to their delegators (staker).

    uint128 public emissionRate; // Number of UMA emitted per second to incentivize stakers.

    uint128 public cumulativeStake; // Total number of UMA staked within the system.

    uint128 public rewardPerTokenStored; // Tracker used to allocate pro-rata share of rewards to stakers.

    uint64 public unstakeCoolDown; // Delay, in seconds, a staker must wait when trying to unstake their UMA.

    uint64 public lastUpdateTime; // Tracks the last time the reward rate was updated, used in reward allocation.

    ExpandedIERC20 public immutable votingToken; // An instance of the UMA voting token to mint rewards for stakers

    /****************************************
     *                EVENTS                *
     ****************************************/

    event Staked(
        address indexed voter,
        address indexed from,
        uint128 amount,
        uint128 voterStake,
        uint128 voterPendingUnstake,
        uint128 cumulativeStake
    );

    event RequestedUnstake(address indexed voter, uint128 amount, uint64 unstakeTime, uint128 voterStake);

    event ExecutedUnstake(address indexed voter, uint128 tokensSent, uint128 voterStake);

    event WithdrawnRewards(address indexed voter, address indexed delegate, uint128 tokensWithdrawn);

    event UpdatedReward(address indexed voter, uint128 newReward, uint64 lastUpdateTime);

    event SetNewEmissionRate(uint128 newEmissionRate);

    event SetNewUnstakeCoolDown(uint64 newUnstakeCoolDown);

    event DelegateSet(address indexed delegator, address indexed delegate);

    event DelegatorSet(address indexed delegate, address indexed delegator);

    /**
     * @notice Construct the Staker contract
     * @param _emissionRate amount of voting tokens that are emitted per second, split pro rata to stakers.
     * @param _unstakeCoolDown time that a voter must wait to unstake after requesting to unstake.
     * @param _votingToken address of the UMA token contract used to commit votes.
     */
    constructor(
        uint128 _emissionRate,
        uint64 _unstakeCoolDown,
        address _votingToken
    ) {
        setEmissionRate(_emissionRate);
        setUnstakeCoolDown(_unstakeCoolDown);
        votingToken = ExpandedIERC20(_votingToken);
    }

    /****************************************
     *           STAKER FUNCTIONS           *
     ****************************************/

    /**
     * @notice Pulls tokens from the sender's wallet and stakes them on his behalf.
     * @param amount the amount of tokens to stake.
     */
    function stake(uint128 amount) external {
        _stakeTo(msg.sender, msg.sender, amount);
    }

    /**
     * @notice Pulls tokens from the sender's wallet and stakes them for the recipient.
     * @param recipient the recipient address.
     * @param amount the amount of tokens to stake.
     */
    function stakeTo(address recipient, uint128 amount) external {
        _stakeTo(msg.sender, recipient, amount);
    }

    // Pull an amount of votingToken from the from address and stakes them for the recipient address.
    // If we are in an active reveal phase the stake amount will be added to the pending stake.
    // If not, the stake amount will be added to the stake.
    function _stakeTo(
        address from,
        address recipient,
        uint128 amount
    ) internal {
        require(amount > 0, "Cannot stake 0");

        VoterStake storage voterStake = voterStakes[recipient];

        // If the staker has a cumulative staked balance of 0 then we can shortcut their nextIndexToProcess to
        // the most recent index. This means we don't need to traverse requests where the staker was not staked.
        // _getStartingIndexForStaker returns the appropriate index to start at.
        if (voterStake.stake == 0) voterStake.nextIndexToProcess = _getStartingIndexForStaker();
        _updateTrackers(recipient);

        // Compute pending stakes when needed.
        _computePendingStakes(recipient, amount);

        voterStake.stake += amount;
        cumulativeStake += amount;

        // Tokens are pulled from the from address and sent to this contract.
        // During withdrawAndRestake, from is the same as the address of this contract, so there is no need to transfer.
        if (from != address(this)) votingToken.transferFrom(from, address(this), amount);
        emit Staked(recipient, from, amount, voterStake.stake, voterStake.pendingUnstake, cumulativeStake);
    }

    /**
     * @notice Request a certain number of tokens to be unstaked. After the unstake time expires, the user may execute
     * the unstake. Tokens requested to unstake are not slashable nor subject to earning rewards.
     * This function cannot be called during an active reveal phase.
     * Note there is no way to cancel an unstake request, you must wait until after unstakeTime and re-stake.
     * @param amount the amount of tokens to request to be unstaked.
     */
    function requestUnstake(uint128 amount) external nonReentrant() {
        require(!_inActiveReveal(), "In an active reveal phase");
        require(amount > 0, "Cannot unstake 0");
        _updateTrackers(msg.sender);
        VoterStake storage voterStake = voterStakes[msg.sender];

        require(voterStake.stake >= amount && voterStake.pendingUnstake == 0, "Bad amount or pending unstake");

        cumulativeStake -= amount;
        voterStake.pendingUnstake = amount;
        voterStake.stake -= amount;
        voterStake.unstakeTime = uint64(getCurrentTime()) + unstakeCoolDown;

        emit RequestedUnstake(msg.sender, amount, voterStake.unstakeTime, voterStake.stake);
    }

    /**
     * @notice  Execute a previously requested unstake. Requires the unstake time to have passed.
     * @dev If a staker requested an unstake and time > unstakeTime then send funds to staker. If unstakeCoolDown is
     * set to 0 then the unstake can be executed immediately.
     */
    function executeUnstake() external nonReentrant() {
        VoterStake storage voterStake = voterStakes[msg.sender];
        require(
            voterStake.unstakeTime != 0 && (getCurrentTime() >= voterStake.unstakeTime || unstakeCoolDown == 0),
            "Unstake time not passed"
        );
        uint128 tokensToSend = voterStake.pendingUnstake;

        if (tokensToSend > 0) {
            voterStake.pendingUnstake = 0;
            voterStake.unstakeTime = 0;
            votingToken.transfer(msg.sender, tokensToSend);
        }

        emit ExecutedUnstake(msg.sender, tokensToSend, voterStake.stake);
    }

    /**
     * @notice Send accumulated rewards to the voter. Note that these rewards do not include slashing balance changes.
     * @return uint128 the amount of tokens sent to the voter.
     */
    function withdrawRewards() external returns (uint128) {
        return _withdrawRewards(msg.sender, msg.sender);
    }

    // Withdraws rewards for a given voter and sends them to the recipient.
    function _withdrawRewards(address voter, address recipient) internal returns (uint128) {
        _updateTrackers(voter);
        VoterStake storage voterStake = voterStakes[voter];

        uint128 tokensToMint = voterStake.outstandingRewards;
        if (tokensToMint > 0) {
            voterStake.outstandingRewards = 0;
            require(votingToken.mint(recipient, tokensToMint), "Voting token issuance failed");
            emit WithdrawnRewards(voter, msg.sender, tokensToMint);
        }
        return tokensToMint;
    }

    /**
     * @notice Stake accumulated rewards. This is merely a convenience mechanism that combines the voter's withdrawal
     * and stake in the same transaction if requested by a delegate or the voter.
     * @dev The rewarded tokens simply pass through this contract before being staked on the voter's behalf.
     *  The balance of the delegate remains unchanged.
     * @return uint128 the amount of tokens that the voter is staking.
     */
    function withdrawAndRestake() external returns (uint128) {
        address voter = getVoterFromDelegate(msg.sender);
        uint128 rewards = _withdrawRewards(voter, address(this));
        _stakeTo(address(this), voter, rewards);
        return rewards;
    }

    /**
     * @notice Sets the delegate of a voter. This delegate can vote on behalf of the staker. The staker will still own
     * all staked balances, receive rewards and be slashed based on the actions of the delegate. Intended use is using a
     * low-security available wallet for voting while keeping access to staked amounts secure by a more secure wallet.
     * @param delegate the address of the delegate.
     */
    function setDelegate(address delegate) external {
        voterStakes[msg.sender].delegate = delegate;
        emit DelegateSet(msg.sender, delegate);
    }

    /**
     * @notice Sets the delegator of a voter. Acts to accept a delegation. The delegate can only vote for the delegator
     * if the delegator also selected the delegate to do so (two-way relationship needed).
     * @param delegator the address of the delegator.
     */
    function setDelegator(address delegator) external {
        delegateToStaker[msg.sender] = delegator;
        emit DelegatorSet(msg.sender, delegator);
    }

    /****************************************
     *        OWNER ADMIN FUNCTIONS         *
     ****************************************/

    /**
     * @notice  Set the token's emission rate, the number of voting tokens that are emitted per second.
     * @param newEmissionRate the new amount of voting tokens that are emitted per second, split pro rata to stakers.
     */
    function setEmissionRate(uint128 newEmissionRate) public onlyOwner {
        _updateReward(address(0));
        emissionRate = newEmissionRate;
        emit SetNewEmissionRate(newEmissionRate);
    }

    /**
     * @notice  Set the amount of time a voter must wait to unstake after submitting a request to do so.
     * @param newUnstakeCoolDown the new duration of the cool down period in seconds.
     */
    function setUnstakeCoolDown(uint64 newUnstakeCoolDown) public onlyOwner {
        unstakeCoolDown = newUnstakeCoolDown;
        emit SetNewUnstakeCoolDown(newUnstakeCoolDown);
    }

    // Updates an account internal trackers.
    function _updateTrackers(address voter) internal virtual {
        _updateReward(voter);
    }

    /****************************************
     *            VIEW FUNCTIONS            *
     ****************************************/

    /**
     * @notice Gets the pending stake for a voter for a given round.
     * @param voter the voter address.
     * @param roundId round id.
     * @return uint128 amount of the pending stake.
     */
    function getVoterPendingStake(address voter, uint32 roundId) external view returns (uint128) {
        return voterStakes[voter].pendingStakes[roundId];
    }

    /**
     * @notice Gets the voter from the delegate.
     * @param caller caller of the function or the address to check in the mapping between a voter and their delegate.
     * @return address voter that corresponds to the delegate.
     */
    function getVoterFromDelegate(address caller) public view returns (address) {
        address delegator = delegateToStaker[caller];
        // The delegate chose to be a delegate for the staker.
        if (delegator != address(0) && voterStakes[delegator].delegate == caller) return delegator;
        else return caller; // The staker chose the delegate.
    }

    /**
     * @notice  Determine the number of outstanding token rewards that can be withdrawn by a voter.
     * @param voter the address of the voter.
     * @return uint256 the outstanding rewards.
     */
    function outstandingRewards(address voter) public view returns (uint256) {
        VoterStake storage voterStake = voterStakes[voter];

        return
            ((voterStake.stake * (rewardPerToken() - voterStake.rewardsPaidPerToken)) / 1e18) +
            voterStake.outstandingRewards;
    }

    /**
     * @notice  Calculate the reward per token based on the last time the reward was updated.
     * @return uint256 the reward per token.
     */
    function rewardPerToken() public view returns (uint256) {
        if (cumulativeStake == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((getCurrentTime() - lastUpdateTime) * emissionRate * 1e18) / cumulativeStake;
    }

    /**
     * @notice Returns the total amount of tokens staked by the voter, after applying updateTrackers. Specifically used
     * by offchain apps to simulate the cumulative stake + unapplied slashing updates without sending a transaction.
     * @param voter the address of the voter.
     * @return uint128 the total stake.
     */
    function getVoterStakePostUpdate(address voter) external returns (uint128) {
        _updateTrackers(voter);
        return voterStakes[voter].stake;
    }

    /**
     * @notice Returns the current block timestamp.
     * @dev Can be overridden to control contract time.
     * @return the current block timestamp.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    // This function must be called before any tokens are staked. Update the voter's pending stakes when necessary.
    // The contract that inherits from Staker (e.g. VotingV2) must implement this logic by overriding this function.
    function _computePendingStakes(address voter, uint128 amount) internal virtual;

    // Add a new stake amount to the voter's pending stake for a specific round id.
    function _incrementPendingStake(
        address voter,
        uint32 roundId,
        uint128 amount
    ) internal {
        voterStakes[voter].pendingStakes[roundId] += amount;
    }

    // Determine if we are in an active reveal phase. This function should be overridden by the child contract.
    function _inActiveReveal() internal view virtual returns (bool) {
        return false;
    }

    // Returns the starting index for a staker. This function should be overridden by the implementing contract.
    function _getStartingIndexForStaker() internal virtual returns (uint64) {
        return 0;
    }

    // Calculate the reward per token based on last time the reward was updated.
    function _updateReward(address voter) internal {
        uint128 newRewardPerToken = uint128(rewardPerToken());
        rewardPerTokenStored = newRewardPerToken;
        lastUpdateTime = uint64(getCurrentTime());
        if (voter != address(0)) {
            VoterStake storage voterStake = voterStakes[voter];
            voterStake.outstandingRewards = uint128(outstandingRewards(voter));
            voterStake.rewardsPaidPerToken = newRewardPerToken;
        }
        emit UpdatedReward(voter, newRewardPerToken, lastUpdateTime);
    }
}
