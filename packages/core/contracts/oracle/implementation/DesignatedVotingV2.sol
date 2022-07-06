// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../common/implementation/MultiRole.sol";
import "../../common/implementation/Stakeable.sol";
import "../interfaces/VotingAncillaryInterface.sol";
import "../interfaces/FinderInterface.sol";
import "./Constants.sol";

/**
 * @title Proxy to allow voting from another address.
 * @dev Allows a UMA token holder to designate another address to vote on their behalf.
 * Each voter must deploy their own instance of this contract.
 */
contract DesignatedVotingV2 is Stakeable {
    /****************************************
     *    INTERNAL VARIABLES AND STORAGE    *
     ****************************************/

    enum Roles {
        Owner, // Can set the Voter role. Is also permanently permissioned as the minter role.
        Voter // Can vote through this contract.
    }

    // Reference to the UMA Finder contract, allowing Voting upgrades to be performed
    // without requiring any calls to this contract.
    FinderInterface private finder;

    /**
     * @notice Construct the DesignatedVoting contract.
     * @param finderAddress keeps track of all contracts within the system based on their interfaceName.
     * @param ownerAddress address of the owner of the DesignatedVoting contract.
     * @param voterAddress address to which the owner has delegated their voting power.
     */
    constructor(
        address finderAddress,
        address ownerAddress,
        address voterAddress
    ) {
        _createExclusiveRole(uint256(Roles.Owner), uint256(Roles.Owner), ownerAddress);
        _createExclusiveRole(uint256(Roles.Voter), uint256(Roles.Owner), voterAddress);
        _setWithdrawRole(uint256(Roles.Owner));
        _setStakeRole(uint256(Roles.Owner));

        finder = FinderInterface(finderAddress);
    }

    /****************************************
     *   VOTING AND REWARD FUNCTIONALITY    *
     ****************************************/

    /**
     * @notice Forwards a commit to Voting.
     * @param identifier uniquely identifies the feed for this vote. EG BTC/USD price pair.
     * @param time specifies the unix timestamp of the price being voted on.
     * @param hash the keccak256 hash of the price you want to vote for and a random integer salt value.
     */
    function commitVote(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bytes32 hash
    ) external onlyRoleHolder(uint256(Roles.Voter)) {
        _getVotingContract().commitVote(identifier, time, ancillaryData, hash);
    }

    /**
     * @notice Forwards a batch commit to Voting.
     * @param commits struct to encapsulate an `identifier`, `time`, `hash` and optional `encryptedVote`.
     */
    function batchCommit(VotingAncillaryInterface.CommitmentAncillary[] calldata commits)
        external
        onlyRoleHolder(uint256(Roles.Voter))
    {
        _getVotingContract().batchCommit(commits);
    }

    /**
     * @notice Forwards a reveal to Voting.
     * @param identifier voted on in the commit phase. EG BTC/USD price pair.
     * @param time specifies the unix timestamp of the price being voted on.
     * @param price used along with the `salt` to produce the `hash` during the commit phase.
     * @param salt used along with the `price` to produce the `hash` during the commit phase.
     */
    function revealVote(
        bytes32 identifier,
        uint256 time,
        int256 price,
        bytes memory ancillaryData,
        int256 salt
    ) external onlyRoleHolder(uint256(Roles.Voter)) {
        _getVotingContract().revealVote(identifier, time, price, ancillaryData, salt);
    }

    /**
     * @notice Forwards a batch reveal to Voting.
     * @param reveals is an array of the Reveal struct which contains an identifier, time, price and salt.
     */
    function batchReveal(VotingAncillaryInterface.RevealAncillary[] calldata reveals)
        external
        onlyRoleHolder(uint256(Roles.Voter))
    {
        _getVotingContract().batchReveal(reveals);
    }

    /**
     * @notice Forwards a reward retrieval to Voting.
     * @dev Rewards are added to the tokens already held by this contract.
     * @return amount of rewards that the user should receive.
     */
    function retrieveRewards() public onlyRoleHolder(uint256(Roles.Voter)) returns (uint256) {
        StakerInterface voting = StakerInterface(address(_getVotingContract()));
        uint256 rewardsMinted = voting.withdrawRewards();
        IERC20(address(voting.votingToken())).approve(address(voting), rewardsMinted);
        voting.stake(rewardsMinted);
    }

    function _getVotingContract() private view returns (VotingAncillaryInterface) {
        return VotingAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }
}
