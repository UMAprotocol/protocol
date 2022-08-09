// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../implementation/VotingToken.sol";
import "../../common/interfaces/ExpandedIERC20.sol";

interface StakerInterface {
    function votingToken() external returns (ExpandedIERC20);

    function stake(uint256 amount) external;

    function requestUnstake(uint256 amount) external;

    function executeUnstake() external;

    function withdrawRewards() external returns (uint256);
}
