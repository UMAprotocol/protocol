// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/StakerInterface.sol";
import "../../common/interfaces/ExpandedIERC20.sol";

import "./VotingToken.sol";
import "../../common/implementation/Lockable.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title Staking contract enabling UMA to be locked up by stakers to earn a pro rata share of a fixed emission rate.
 * @dev Handles the staking, unstaking and reward retrieval logic.
 */
abstract contract Staker is StakerInterface, Ownable, Lockable {
    /****************************************
     *           STAKING TRACKERS           *
     ****************************************/

    uint256 public emissionRate;
    uint256 public cumulativeActiveStake;
    uint256 public cumulativePendingStake;
    uint256 public rewardPerTokenStored;
    uint64 public lastUpdateTime;
    uint64 public unstakeCoolDown;

    ExpandedIERC20 public votingToken;

    struct VoterStake {
        uint256 activeStake;
        uint256 pendingUnstake;
        uint256 pendingStake;
        uint256 rewardsPaidPerToken;
        uint256 outstandingRewards;
        int256 unappliedSlash;
        uint64 nextIndexToProcess;
        uint64 unstakeRequestTime;
        address delegate;
    }

    mapping(address => VoterStake) public voterStakes;
    mapping(address => address) public delegateToStaker;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event Staked(
        address indexed voter,
        address indexed from,
        uint256 amount,
        uint256 voterActiveStake,
        uint256 voterPendingStake,
        uint256 voterPendingUnstake,
        uint256 cumulativeActiveStake,
        uint256 cumulativePendingStake
    );

    event RequestedUnstake(
        address indexed voter,
        uint256 amount,
        uint256 unstakeTime,
        uint256 voterActiveStake,
        uint256 voterPendingStake
    );

    event ExecutedUnstake(
        address indexed voter,
        uint256 tokensSent,
        uint256 voterActiveStake,
        uint256 voterPendingStake
    );

    event WithdrawnRewards(address indexed voter, address indexed delegate, uint256 tokensWithdrawn);

    event UpdatedReward(address indexed voter, uint256 newReward, uint256 lastUpdateTime);

    event UpdatedActiveStake(
        address indexed voter,
        uint256 voterActiveStake,
        uint256 voterPendingStake,
        uint256 cumulativeActiveStake,
        uint256 cumulativePendingStake
    );

    event SetNewEmissionRate(uint256 newEmissionRate);

    event SetNewUnstakeCoolDown(uint256 newUnstakeCoolDown);

    /**
     * @notice Construct the Staker contract
     * @param _emissionRate amount of voting tokens that are emitted per second, split pro rata to stakers.
     * @param _unstakeCoolDown time that a voter must wait to unstake after requesting to unstake.
     * @param _votingToken address of the UMA token contract used to commit votes.
     */
    constructor(
        uint256 _emissionRate,
        uint64 _unstakeCoolDown,
        address _votingToken
    ) {
        emissionRate = _emissionRate;
        unstakeCoolDown = _unstakeCoolDown;
        votingToken = ExpandedIERC20(_votingToken);
    }

    /****************************************
     *           STAKER FUNCTIONS           *
     ****************************************/

    /**
     * @notice Pulls tokens from users wallet and stakes them. If we are in an active reveal phase the stake amount will
     * be added to the pending stake. If not, the stake amount will be added to the active stake.
     * @param amount the amount of tokens to stake.
     */
    function stake(uint256 amount) public {
        _stakeTo(msg.sender, msg.sender, amount);
    }

    /**
     * @notice Pulls tokens from sender wallet and stakes them for the recipient. If we are in an active reveal phase the
     * stake amount will be added to the pending stake. If not, the stake amount will be added to the active stake.
     * @param recipient the recipient address.
     * @param amount the amount of tokens to stake.
     */
    function stakeTo(address recipient, uint256 amount) public {
        _stakeTo(msg.sender, recipient, amount);
    }

    function _stakeTo(
        address from,
        address recipient,
        uint256 amount
    ) internal {
        VoterStake storage voterStake = voterStakes[recipient];

        // If the staker has a cumulative staked balance of 0 then we can shortcut their lastRequestIndexConsidered to
        // the most recent index. This means we don't need to traverse requests where the staker was not staked.
        // _getStartingIndexForStaker returns the appropriate index to start at.
        if (getVoterStake(recipient) + voterStake.pendingUnstake == 0)
            voterStake.nextIndexToProcess = _getStartingIndexForStaker();
        _updateTrackers(recipient);

        if (_inActiveReveal()) {
            voterStake.pendingStake += amount;
            cumulativePendingStake += amount;
        } else {
            voterStake.activeStake += amount;
            cumulativeActiveStake += amount;
        }
        // Pull tokens from "from" address and transfer them to this contract.
        // During withdrawAndRestake, "from" is the same as the address of this contract, so there is no need to transfer.
        if (from != address(this)) votingToken.transferFrom(from, address(this), amount);
        emit Staked(
            recipient,
            from,
            amount,
            voterStake.activeStake,
            voterStake.pendingStake,
            voterStake.pendingUnstake,
            cumulativeActiveStake,
            cumulativePendingStake
        );
    }

    /**
     * @notice Request a certain number of tokens to be unstaked. After the unstake time expires, the user may execute
     * the unstake. Tokens requested to unstake are not slashable nor subject to earning rewards.
     * This function cannot be called during an active reveal phase.
     * Note that there is no way to cancel an unstake request, you must wait until after unstakeRequestTime and re-stake.
     * @param amount the amount of tokens to request to be unstaked.
     */
    function requestUnstake(uint256 amount) external override nonReentrant() {
        require(!_inActiveReveal(), "In an active reveal phase");
        _updateTrackers(msg.sender);
        VoterStake storage voterStake = voterStakes[msg.sender];

        require(voterStake.activeStake >= amount, "Bad request amount");
        require(voterStake.pendingUnstake == 0, "Have previous request unstake");

        cumulativeActiveStake -= amount;
        voterStake.pendingUnstake = amount;
        voterStake.activeStake -= amount;
        voterStake.unstakeRequestTime = SafeCast.toUint64(getCurrentTime());

        emit RequestedUnstake(
            msg.sender,
            amount,
            voterStake.unstakeRequestTime,
            voterStake.activeStake,
            voterStake.pendingStake
        );
    }

    /**
     * @notice  Execute a previously requested unstake. Requires the unstake time to have passed.
     * @dev If a staker requested an unstake and time > unstakeRequestTime then send funds to staker.
     */
    function executeUnstake() external override nonReentrant() {
        VoterStake storage voterStake = voterStakes[msg.sender];
        require(
            voterStake.unstakeRequestTime != 0 && getCurrentTime() >= voterStake.unstakeRequestTime + unstakeCoolDown,
            "Unstake time not passed"
        );
        uint256 tokensToSend = voterStake.pendingUnstake;

        if (tokensToSend > 0) {
            voterStake.pendingUnstake = 0;
            voterStake.unstakeRequestTime = 0;
            votingToken.transfer(msg.sender, tokensToSend);
        }

        emit ExecutedUnstake(msg.sender, tokensToSend, voterStake.activeStake, voterStake.pendingStake);
    }

    /**
     * @notice Send accumulated rewards to the voter. Note that these rewards do not include slashing balance changes.
     * @return uint256 the amount of tokens sent to the voter.
     */
    function withdrawRewards() public returns (uint256) {
        return _withdrawRewards(msg.sender, msg.sender);
    }

    function _withdrawRewards(address voter, address recipient) internal returns (uint256) {
        _updateTrackers(voter);
        VoterStake storage voterStake = voterStakes[voter];

        uint256 tokensToMint = voterStake.outstandingRewards;
        if (tokensToMint > 0) {
            voterStake.outstandingRewards = 0;
            require(votingToken.mint(recipient, tokensToMint), "Voting token issuance failed");
            emit WithdrawnRewards(voter, msg.sender, tokensToMint);
        }
        return tokensToMint;
    }

    /**
     * @notice Stake accumulated rewards. This is merely a convenience mechanism that combines the voter's withdrawal and stake
     *  in the same transaction if requested by a delegate or the voter.
     * @dev This method requires that the msg.sender(voter or delegate) has approved this contract.
     * @dev The rewarded tokens simply pass through this contract before being staked on the voter's behalf.
     *  The balance of the delegate remains unchanged.
     * @return uint256 the amount of tokens that the voter is staking.
     */
    function withdrawAndRestake() external override returns (uint256) {
        address voter = getVoterFromDelegate(msg.sender);
        uint256 rewards = _withdrawRewards(voter, address(this));
        _stakeTo(address(this), voter, rewards);
        return rewards;
    }

    /**
     * @notice Sets the delegate of a voter. This delegate can vote on behalf of the staker. The staker will still own
     * all staked balances, receive rewards and be slashed based on the actions of the delegate. Intended use is using a
     * low-security available wallet for voting while keeping access to staked amounts secure by a more secure wallet.
     * @param delegate the address of the delegate.
     */
    function setDelegate(address delegate) external nonReentrant() {
        voterStakes[msg.sender].delegate = delegate;
    }

    /**
     * @notice Sets the delegator of a voter. Acts to accept a delegation. The delegate can only vote for the delegator
     * if the delegator also selected the delegate to do so (two-way relationship needed).
     * @param delegator the address of the delegator.
     */
    function setDelegator(address delegator) external nonReentrant() {
        delegateToStaker[msg.sender] = delegator;
    }

    /****************************************
     *        OWNER ADMIN FUNCTIONS         *
     ****************************************/

    /**
     * @notice  Set the token's emission rate, the number of voting tokens that are emitted per second per staked token,
     * split pro rata to stakers.
     * @param newEmissionRate the new amount of voting tokens that are emitted per second, split pro rata to stakers.
     */
    function setEmissionRate(uint256 newEmissionRate) external onlyOwner {
        _updateReward(address(0));
        emissionRate = newEmissionRate;
        emit SetNewEmissionRate(newEmissionRate);
    }

    /**
     * @notice  Set the amount of time a voter must wait to unstake after submitting a request to do so.
     * @param newUnstakeCoolDown the new duration of the cool down period in seconds.
     */
    function setUnstakeCoolDown(uint64 newUnstakeCoolDown) external onlyOwner {
        unstakeCoolDown = newUnstakeCoolDown;
        emit SetNewUnstakeCoolDown(newUnstakeCoolDown);
    }

    function _updateTrackers(address voterAddress) internal virtual {
        _updateReward(voterAddress);
        _updateActiveStake(voterAddress);
    }

    /****************************************
     *            VIEW FUNCTIONS            *
     ****************************************/

    /**
     * @notice Gets the voter from the delegate.
     * @param caller caller of the function or the address to check in the mapping between a voter and their delegate.
     * @return address voter that corresponds to the delegate.
     */
    function getVoterFromDelegate(address caller) public view returns (address) {
        if (
            delegateToStaker[caller] != address(0) && // The delegate chose to be a delegate for the staker.
            voterStakes[delegateToStaker[caller]].delegate == caller // The staker chose the delegate.
        ) return delegateToStaker[caller];
        else return caller;
    }

    /**
     * @notice  Determine the number of outstanding token rewards that can be withdrawn by a voter.
     * @param voterAddress the address of the voter.
     * @return uint256 the outstanding rewards.
     */
    function outstandingRewards(address voterAddress) public view returns (uint256) {
        VoterStake storage voterStake = voterStakes[voterAddress];

        return
            ((getVoterStake(voterAddress) * (rewardPerToken() - voterStake.rewardsPaidPerToken)) / 1e18) +
            voterStake.outstandingRewards;
    }

    /**
     * @notice  Calculate the reward per token based on the last time the reward was updated.
     * @return uint256 the reward per token.
     */
    function rewardPerToken() public view returns (uint256) {
        if (getCumulativeStake() == 0) return rewardPerTokenStored;
        return
            rewardPerTokenStored + ((getCurrentTime() - lastUpdateTime) * emissionRate * 1e18) / getCumulativeStake();
    }

    /**
     * @notice  Returns the total amount of tokens staked. This is the sum of the active stake and the pending stake.
     * @return uint256 the cumulative stake.
     */
    function getCumulativeStake() public view returns (uint256) {
        return cumulativeActiveStake + cumulativePendingStake;
    }

    /**
     * @notice  Returns the total amount of tokens staked by the voter.
     * @param voterAddress the address of the voter.
     * @return uint256 the total stake.
     */
    function getVoterStake(address voterAddress) public view returns (uint256) {
        return voterStakes[voterAddress].activeStake + voterStakes[voterAddress].pendingStake;
    }

    /**
     * @notice Returns the current block timestamp.
     * @dev Can be overridden to control contract time.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    // Determine if we are in an active reveal phase. This function should be overridden by the child contract.
    function _inActiveReveal() internal view virtual returns (bool) {
        return false;
    }

    function _getStartingIndexForStaker() internal view virtual returns (uint64) {
        return 0;
    }

    // Calculate the reward per token based on last time the reward was updated.
    function _updateReward(address voterAddress) internal {
        uint256 newRewardPerToken = rewardPerToken();
        rewardPerTokenStored = newRewardPerToken;
        lastUpdateTime = SafeCast.toUint64(getCurrentTime());
        if (voterAddress != address(0)) {
            VoterStake storage voterStake = voterStakes[voterAddress];
            voterStake.outstandingRewards = outstandingRewards(voterAddress);
            voterStake.rewardsPaidPerToken = newRewardPerToken;
        }
        emit UpdatedReward(voterAddress, newRewardPerToken, lastUpdateTime);
    }

    // Updates the active stake of the voter if not in an active reveal phase.
    function _updateActiveStake(address voterAddress) internal {
        if (voterStakes[voterAddress].pendingStake == 0 || _inActiveReveal()) return;
        cumulativeActiveStake += voterStakes[voterAddress].pendingStake;
        cumulativePendingStake -= voterStakes[voterAddress].pendingStake;
        voterStakes[voterAddress].activeStake += voterStakes[voterAddress].pendingStake;
        voterStakes[voterAddress].pendingStake = 0;

        emit UpdatedActiveStake(
            voterAddress,
            voterStakes[voterAddress].activeStake,
            voterStakes[voterAddress].pendingStake,
            cumulativeActiveStake,
            cumulativePendingStake
        );
    }
}
