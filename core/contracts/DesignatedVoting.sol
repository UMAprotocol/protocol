pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "./Finder.sol";
import "./MultiRole.sol";
import "./Withdrawable.sol";
import "./Voting.sol";
import "./VotingInterface.sol";


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
    Finder private finder;

    constructor(address finderAddress, address ownerAddress, address voterAddress) public {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), ownerAddress);
        _createExclusiveRole(uint(Roles.Voter), uint(Roles.Owner), voterAddress);
        setWithdrawRole(uint(Roles.Owner));

        finder = Finder(finderAddress);
    }

    /**
     * @notice Forwards a commit to Voting.
     */
    function commitVote(bytes32 identifier, uint time, bytes32 hash) external onlyRoleHolder(uint(Roles.Voter)) {
        _getVotingAddress().commitVote(identifier, time, hash);
    }

    /**
     * @notice Forwards a reveal to Voting.
     */
    function revealVote(bytes32 identifier, uint time, int price, int salt) external onlyRoleHolder(uint(Roles.Voter)) {
        _getVotingAddress().revealVote(identifier, time, price, salt);
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

    function _getVotingAddress() private view returns (Voting) {
        return Voting(finder.getImplementationAddress("Oracle"));
    }
}
