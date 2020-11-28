// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/Testable.sol";
import "../interfaces/OracleInterface.sol";
import "../interfaces/VotingInterface.sol";

// A mock oracle used for testing. Exports the oracle voting interface, voting interface, testing and some additional
// methods which are only accessible directly on the voting contract.
abstract contract VotingInterfaceTesting is OracleInterface, VotingInterface, Testable {
    using FixedPoint for FixedPoint.Unsigned;

    // Extra helper interfaces.

    event VoteCommitted(
        address indexed voter,
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData
    );

    event EncryptedVote(
        address indexed voter,
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        bytes encryptedVote
    );

    event VoteRevealed(
        address indexed voter,
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        int256 price,
        bytes ancillaryData,
        uint256 numTokens
    );

    event RewardsRetrieved(
        address indexed voter,
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        uint256 numTokens
    );

    event PriceRequestAdded(uint256 indexed roundId, bytes32 indexed identifier, uint256 time);

    event PriceResolved(
        uint256 indexed roundId,
        bytes32 indexed identifier,
        uint256 time,
        bytes ancillaryData,
        int256 price
    );

    struct Round {
        uint256 snapshotId; // Voting token snapshot ID for this round.  0 if no snapshot has been taken.
        FixedPoint.Unsigned inflationRate; // Inflation rate set for this round.
        FixedPoint.Unsigned gatPercentage; // Gat rate set for this round.
        uint256 rewardsExpirationTime; // Time that rewards for this round can be claimed until.
    }

    // Represents the status a price request has.
    enum RequestStatus {
        NotRequested, // Was never requested.
        Active, // Is being voted on in the current round.
        Resolved, // Was resolved in a previous round.
        Future // Is scheduled to be voted on in a future round.
    }

    // Only used as a return value in view methods -- never stored in the contract.
    struct RequestState {
        RequestStatus status;
        uint256 lastVotingRound;
    }

    function rounds(uint256 roundId) public view virtual returns (Round memory);

    function getPriceRequestStatuses(VotingInterface.PendingRequest[] memory requests)
        public
        view
        virtual
        returns (RequestState[] memory);

    function getPendingPriceRequestsArray() external view virtual returns (bytes32[] memory);
}
