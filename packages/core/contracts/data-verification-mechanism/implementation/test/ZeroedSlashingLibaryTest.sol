// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../../interfaces/SlashingLibraryInterface.sol";

/**
 * @title Slashing Library contract that executes no slashing for any actions. Used in tests.
 */

contract ZeroedSlashingSlashingLibraryTest is SlashingLibraryInterface {
    function calcWrongVoteSlashPerToken(
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public pure returns (uint128) {
        return 0;
    }

    function calcWrongVoteSlashPerTokenGovernance(
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public pure returns (uint128) {
        return 0;
    }

    function calcNoVoteSlashPerToken(
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex
    ) public pure returns (uint128) {
        return 0;
    }

    function calcSlashing(
        uint128 totalStaked,
        uint128 totalVotes,
        uint128 totalCorrectVotes,
        uint256 priceRequestIndex,
        bool isGovernance
    ) external pure returns (uint128 wrongVoteSlashPerToken, uint128 noVoteSlashPerToken) {
        return (
            isGovernance
                ? calcWrongVoteSlashPerTokenGovernance(totalStaked, totalVotes, totalCorrectVotes, priceRequestIndex)
                : calcWrongVoteSlashPerToken(totalStaked, totalVotes, totalCorrectVotes, priceRequestIndex),
            calcNoVoteSlashPerToken(totalStaked, totalVotes, totalCorrectVotes, priceRequestIndex)
        );
    }
}
