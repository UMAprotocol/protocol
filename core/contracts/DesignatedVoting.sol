pragma solidity ^0.5.0;

import "./Finder.sol";
import "./MultiRole.sol";
import "./Withdrawable.sol";
import "./Voting.sol";


/**
 * @title Designated Voting
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

    constructor(address finderAddress) public {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        _createExclusiveRole(uint(Roles.Voter), uint(Roles.Owner), msg.sender);
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
    function retrieveRewards() external onlyRoleHolder(uint(Roles.Voter)) {
        _getVotingAddress().retrieveRewards();
    }

    function _getVotingAddress() private view returns (Voting) {
        return Voting(finder.getImplementationAddress("Oracle"));
    }
}
