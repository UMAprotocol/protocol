import "../implementation/VotingToken.sol";

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

interface StakerInterface {
    function votingToken() external returns (VotingToken);

    function stake(uint256 amount) external;

    function requestUnstake(uint256 amount) external;

    function executeUnstake() external;

    function withdrawRewards() external returns (uint256);
}
