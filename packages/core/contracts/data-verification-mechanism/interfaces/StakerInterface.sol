// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../implementation/VotingToken.sol";
import "../../common/interfaces/ExpandedIERC20.sol";

interface StakerInterface {
    function votingToken() external returns (ExpandedIERC20);

    function stake(uint128 amount) external;

    function requestUnstake(uint128 amount) external;

    function executeUnstake() external;

    function withdrawRewards() external returns (uint128);

    function withdrawAndRestake() external returns (uint128);

    function setEmissionRate(uint128 newEmissionRate) external;

    function setUnstakeCoolDown(uint64 newUnstakeCoolDown) external;

    /**
     * @notice Sets the delegate of a voter. This delegate can vote on behalf of the staker. The staker will still own
     * all staked balances, receive rewards and be slashed based on the actions of the delegate. Intended use is using a
     * low-security available wallet for voting while keeping access to staked amounts secure by a more secure wallet.
     * @param delegate the address of the delegate.
     */
    function setDelegate(address delegate) external virtual;

    /**
     * @notice Sets the delegator of a voter. Acts to accept a delegation. The delegate can only vote for the delegator
     * if the delegator also selected the delegate to do so (two-way relationship needed).
     * @param delegator the address of the delegator.
     */
    function setDelegator(address delegator) external virtual;
}
