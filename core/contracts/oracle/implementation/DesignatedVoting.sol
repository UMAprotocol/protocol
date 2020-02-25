pragma solidity ^0.6.0;

pragma experimental ABIEncoderV2;

import "../../common/MultiRole.sol";
import "../../common/Withdrawable.sol";
import "../interfaces/VotingInterface.sol";
import "../interfaces/FinderInterface.sol";

/**
 * @title Proxy to allow voting from another address
 * @dev Allows a UMA token holder to designate another address to vote on their behalf. Each voter must deploy their own
 * instance of this contract.
 */
contract DesignatedVoting is MultiRole, Withdrawable {
    enum Roles {
        // Can set the Voter and Withdrawer roles.
        Owner,
        // Can vote through this contract.
        Voter
    }

    // Reference to the UMA Finder contract, allowing Voting upgrades to be performed without requiring any calls to
    // this contract.
    FinderInterface private finder;

    constructor(address finderAddress, address ownerAddress, address voterAddress) public {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), ownerAddress);
        _createExclusiveRole(uint(Roles.Voter), uint(Roles.Owner), voterAddress);
        setWithdrawRole(uint(Roles.Owner));

        finder = FinderInterface(finderAddress);
    }

    /**
     * @notice Forwards a commit to Voting.
     */
    function commitVote(bytes32 identifier, uint time, bytes32 hash) external onlyRoleHolder(uint(Roles.Voter)) {
        _getVotingAddress().commitVote(identifier, time, hash);
    }

    /**
     * @notice Forwards a batch commit to Voting.
     */
    function batchCommit(VotingInterface.Commitment[] calldata commits) external onlyRoleHolder(uint(Roles.Voter)) {
        _getVotingAddress().batchCommit(commits);
    }

    /**
     * @notice Forwards a reveal to Voting.
     */
    function revealVote(bytes32 identifier, uint time, int price, int salt) external onlyRoleHolder(uint(Roles.Voter)) {
        _getVotingAddress().revealVote(identifier, time, price, salt);
    }

    /**
     * @notice Forwards a batch reveal to Voting.
     */
    function batchReveal(VotingInterface.Reveal[] calldata reveals) external onlyRoleHolder(uint(Roles.Voter)) {
        _getVotingAddress().batchReveal(reveals);
    }

    /**
     * @notice Forwards a reward retrieval to Voting.
     */
    function retrieveRewards(uint roundId, VotingInterface.PendingRequest[] memory toRetrieve)
        public
        onlyRoleHolder(uint(Roles.Voter))
        returns (FixedPoint.Unsigned memory rewardsIssued)
    {
        return _getVotingAddress().retrieveRewards(address(this), roundId, toRetrieve);
    }

    function _getVotingAddress() private view returns (VotingInterface) {
        return VotingInterface(finder.getImplementationAddress("Oracle"));
    }
}
