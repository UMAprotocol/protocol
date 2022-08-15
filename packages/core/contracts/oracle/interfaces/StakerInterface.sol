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

    function withdrawAndRestake() external returns (uint256);

    function setEmissionRate(uint256 emissionRate) external;

    function setUnstakeCoolDown(uint64 unstakeCoolDown) external;

    function getVoterStake(address voterAddress) external view returns (uint256);

    function getCumulativeStake() external view returns (uint256);
}
