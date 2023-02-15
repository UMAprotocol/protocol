// TODO: add staking/snapshot interfaces to this interface file.

// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

/**
 * @title Interface that voters must use to Vote on price request resolutions.
 */
abstract contract VotingV2Interface {
    struct PendingRequest {
        bytes32 identifier;
        uint256 time;
    }

    struct PendingRequestAncillary {
        bytes32 identifier;
        uint256 time;
        bytes ancillaryData;
    }

    struct PendingRequestAncillaryAugmented {
        uint32 lastVotingRound;
        bool isGovernance;
        uint64 time;
        uint32 rollCount;
        bytes32 identifier;
        bytes ancillaryData;
    }

    // Captures the necessary data for making a commitment.
    // Used as a parameter when making batch commitments.
    // Not used as a data structure for storage.
    struct Commitment {
        bytes32 identifier;
        uint256 time;
        bytes32 hash;
        bytes encryptedVote;
    }

    // Captures the necessary data for revealing a vote.
    // Used as a parameter when making batch reveals.
    // Not used as a data structure for storage.
    struct Reveal {
        bytes32 identifier;
        uint256 time;
        int256 price;
        int256 salt;
    }

    // Captures the necessary data for making a commitment.
    // Used as a parameter when making batch commitments.
    // Not used as a data structure for storage.
    struct CommitmentAncillary {
        bytes32 identifier;
        uint256 time;
        bytes ancillaryData;
        bytes32 hash;
        bytes encryptedVote;
    }

    // Captures the necessary data for revealing a vote.
    // Used as a parameter when making batch reveals.
    // Not used as a data structure for storage.
    struct RevealAncillary {
        bytes32 identifier;
        uint256 time;
        int256 price;
        bytes ancillaryData;
        int256 salt;
    }

    // Note: the phases must be in order. Meaning the first enum value must be the first phase, etc.
    // `NUM_PHASES` is to get the number of phases. It isn't an actual phase, and it should always be last.
    enum Phase { Commit, Reveal, NUM_PHASES }

    /**
     * @notice Commit a vote for a price request for `identifier` at `time`.
     * @dev `identifier`, `time` must correspond to a price request that's currently in the commit phase.
     * Commits can be changed.
     * @dev Since transaction data is public, the salt will be revealed with the vote. While this is the system’s expected behavior,
     * voters should never reuse salts. If someone else is able to guess the voted price and knows that a salt will be reused, then
     * they can determine the vote pre-reveal.
     * @param identifier uniquely identifies the committed vote. EG BTC/USD price pair.
     * @param time unix timestamp of the price being voted on.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @param hash keccak256 hash of the `price`, `salt`, voter `address`, `time`, current `roundId`, and `identifier`.
     */
    function commitVote(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bytes32 hash
    ) public virtual;

    /**
     * @notice commits a vote and logs an event with a data blob, typically an encrypted version of the vote
     * @dev An encrypted version of the vote is emitted in an event `EncryptedVote` to allow off-chain infrastructure to
     * retrieve the commit. The contents of `encryptedVote` are never used on chain: it is purely for convenience.
     * @param identifier unique price pair identifier. Eg: BTC/USD price pair.
     * @param time unix timestamp of for the price request.
     * @param ancillaryData  arbitrary data appended to a price request to give the voters more info from the caller.
     * @param hash keccak256 hash of the price you want to vote for and a `int256 salt`.
     * @param encryptedVote offchain encrypted blob containing the voters amount, time and salt.
     */
    function commitAndEmitEncryptedVote(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bytes32 hash,
        bytes memory encryptedVote
    ) external virtual;

    /**
     * @notice Reveal a previously committed vote for `identifier` at `time`.
     * @dev The revealed `price`, `salt`, `address`, `time`, `roundId`, and `identifier`, must hash to the latest `hash`
     * that `commitVote()` was called with. Only the committer can reveal their vote.
     * @param identifier voted on in the commit phase. EG BTC/USD price pair.
     * @param time specifies the unix timestamp of the price is being voted on.
     * @param price voted on during the commit phase.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     * @param salt value used to hide the commitment price during the commit phase.
     */
    function revealVote(
        bytes32 identifier,
        uint256 time,
        int256 price,
        bytes memory ancillaryData,
        int256 salt
    ) public virtual;

    /**
     * @notice Gets the requests that are being voted on this round.
     * @return pendingRequests array containing identifiers of type PendingRequestAncillaryAugmented.
     */
    function getPendingRequests() external virtual returns (PendingRequestAncillaryAugmented[] memory);

    /**
     * @notice Returns the current voting phase, as a function of the current time.
     * @return Phase to indicate the current phase. Either { Commit, Reveal, NUM_PHASES }.
     */
    function getVotePhase() external view virtual returns (Phase);

    /**
     * @notice Returns the current round ID, as a function of the current time.
     * @return uint256 representing the unique round ID.
     */
    function getCurrentRoundId() external view virtual returns (uint32);

    // Voting Owner functions.

    /**
     * @notice Disables this Voting contract in favor of the migrated one.
     * @dev Can only be called by the contract owner.
     * @param newVotingAddress the newly migrated contract address.
     */
    function setMigrated(address newVotingAddress) external virtual;

    /**
     * @notice Sets the maximum number of rounds to roll a request can have before the DVM auto deletes it.
     * @dev Can only be called by the contract owner.
     * @param newMaxRolls the new number of rounds to roll a request before the DVM auto deletes it.
     */
    function setMaxRolls(uint32 newMaxRolls) external virtual;

    /**
     * @notice Sets the maximum number of requests that can be made in a single round. Used to bound the maximum
     * sequential slashing that can be applied within a single round.
     * @dev Can only be called by the contract owner.
     * @param newMaxRequestsPerRound the new maximum number of requests that can be made in a single round.
     */
    function setMaxRequestPerRound(uint32 newMaxRequestsPerRound) external virtual;

    /**
     * @notice Resets the GAT number and SPAT percentage. The GAT is the minimum number of tokens that must participate
     * in a vote for it to resolve (quorum number). The SPAT is is the minimum percentage of tokens that must agree
     * in a vote for it to resolve (percentage of staked tokens) Note: this change only applies to rounds that
     * have not yet begun.
     * @param newGat sets the next round's GAT and going forward.
     * @param newSpat sets the next round's SPAT and going forward.
     */
    function setGatAndSpat(uint128 newGat, uint64 newSpat) external virtual;

    /**
     * @notice Changes the slashing library used by this contract.
     * @param _newSlashingLibrary new slashing library address.
     */
    function setSlashingLibrary(address _newSlashingLibrary) external virtual;
}
