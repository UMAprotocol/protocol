// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.6;

// https://github.com/gnosis/zodiac/blob/master/contracts/core/Module.sol
import "@gnosis.pm/zodiac/contracts/core/Module.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../data-verification-mechanism/implementation/Constants.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../../data-verification-mechanism/interfaces/IdentifierWhitelistInterface.sol";
import "../../data-verification-mechanism/interfaces/StoreInterface.sol";

import "../../optimistic-oracle-v3/implementation/ClaimData.sol";
import "../../optimistic-oracle-v3/interfaces/OptimisticOracleV3Interface.sol";
import "../../optimistic-oracle-v3/interfaces/OptimisticOracleV3CallbackRecipientInterface.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/interfaces/AddressWhitelistInterface.sol";

/**
 * @title Optimistic Governor
 * @notice A contract that allows optimistic governance of a set of transactions. The contract can be used to propose
 * transactions that can be challenged by anyone. If the challenge is not resolved within a certain liveness period, the
 * transactions can be executed.
 */
contract OptimisticGovernor is OptimisticOracleV3CallbackRecipientInterface, Module, Lockable {
    using SafeERC20 for IERC20;

    event OptimisticGovernorDeployed(address indexed owner, address indexed avatar, address target);

    event TransactionsProposed(
        address indexed proposer,
        uint256 indexed proposalTime,
        bytes32 indexed assertionId,
        Proposal proposal,
        bytes32 proposalHash,
        bytes explanation,
        string rules,
        uint256 challengeWindowEnds
    );

    event TransactionExecuted(
        bytes32 indexed proposalHash,
        bytes32 indexed assertionId,
        uint256 indexed transactionIndex
    );

    event ProposalExecuted(bytes32 indexed proposalHash, bytes32 indexed assertionId);

    event ProposalDeleted(bytes32 indexed proposalHash, bytes32 indexed assertionId);

    event SetCollateralAndBond(IERC20 indexed collateral, uint256 indexed bondAmount);

    event SetRules(string rules);

    event SetLiveness(uint64 indexed liveness);

    event SetIdentifier(bytes32 indexed identifier);

    event SetEscalationManager(address indexed escalationManager);

    event OptimisticOracleChanged(address indexed newOptimisticOracleV3);

    FinderInterface public immutable finder; // Finder used to discover other UMA ecosystem contracts.

    IERC20 public collateral; // Collateral currency used to assert proposed transactions.
    uint64 public liveness; // The amount of time to dispute proposed transactions before they can be executed.
    uint256 public bondAmount; // Configured amount of collateral currency to make assertions for proposed transactions.
    string public rules; // Rules for the Optimistic Governor.
    bytes32 public identifier; // Identifier used to request price from the DVM, compatible with Optimistic Oracle V3.
    OptimisticOracleV3Interface public optimisticOracleV3; // Optimistic Oracle V3 contract used to assert proposed transactions.
    address public escalationManager; // Optional Escalation Manager contract to whitelist proposers / disputers.

    // Keys for assertion claim data.
    bytes public constant PROPOSAL_HASH_KEY = "proposalHash";
    bytes public constant EXPLANATION_KEY = "explanation";
    bytes public constant RULES_KEY = "rules";

    // Struct for a proposed transaction.
    struct Transaction {
        address to; // The address to which the transaction is being sent.
        Enum.Operation operation; // Operation type of transaction: 0 == call, 1 == delegate call.
        uint256 value; // The value, in wei, to be sent with the transaction.
        bytes data; // The data payload to be sent in the transaction.
    }

    // Struct for a proposed set of transactions, used only for off-chain infrastructure.
    struct Proposal {
        Transaction[] transactions;
        uint256 requestTime;
    }

    mapping(bytes32 => bytes32) public assertionIds; // Maps proposal hashes to assertionIds.
    mapping(bytes32 => bytes32) public proposalHashes; // Maps assertionIds to proposal hashes.

    /**
     * @notice Construct Optimistic Governor module.
     * @param _finder Finder address.
     * @param _owner Address of the owner.
     * @param _collateral Address of the ERC20 collateral used for bonds.
     * @param _bondAmount Amount of collateral currency to make assertions for proposed transactions
     * @param _rules Reference to the rules for the Optimistic Governor.
     * @param _identifier The approved identifier to be used with the contract, compatible with Optimistic Oracle V3.
     * @param _liveness The period, in seconds, in which a proposal can be disputed.
     */
    constructor(
        address _finder,
        address _owner,
        address _collateral,
        uint256 _bondAmount,
        string memory _rules,
        bytes32 _identifier,
        uint64 _liveness
    ) {
        bytes memory initializeParams = abi.encode(_owner, _collateral, _bondAmount, _rules, _identifier, _liveness);
        require(_finder != address(0), "Finder address can not be empty");
        finder = FinderInterface(_finder);
        setUp(initializeParams);
    }

    /**
     * @notice Sets up the Optimistic Governor module.
     * @param initializeParams ABI encoded parameters to initialize the module with.
     * @dev This method can be called only either by the constructor or as part of first time initialization when
     * cloning the module.
     */
    function setUp(bytes memory initializeParams) public override initializer {
        _startReentrantGuardDisabled();
        __Ownable_init();
        (
            address _owner,
            address _collateral,
            uint256 _bondAmount,
            string memory _rules,
            bytes32 _identifier,
            uint64 _liveness
        ) = abi.decode(initializeParams, (address, address, uint256, string, bytes32, uint64));
        setCollateralAndBond(IERC20(_collateral), _bondAmount);
        setRules(_rules);
        setIdentifier(_identifier);
        setLiveness(_liveness);
        setAvatar(_owner);
        setTarget(_owner);
        transferOwnership(_owner);
        _sync();

        emit OptimisticGovernorDeployed(_owner, avatar, target);
    }

    /**
     * @notice Sets the collateral and bond amount for proposals.
     * @param _collateral token that will be used for all bonds for the contract.
     * @param _bondAmount amount of the bond token that will need to be paid for future proposals.
     */
    function setCollateralAndBond(IERC20 _collateral, uint256 _bondAmount) public onlyOwner {
        // ERC20 token to be used as collateral (must be approved by UMA governance).
        require(_getCollateralWhitelist().isOnWhitelist(address(_collateral)), "Bond token not supported");
        collateral = _collateral;

        // Value of the bond posted for asserting the proposed transactions. If the minimum amount required by
        // Optimistic Oracle V3 is higher this contract will attempt to pull the required bond amount.
        bondAmount = _bondAmount;

        emit SetCollateralAndBond(_collateral, _bondAmount);
    }

    /**
     * @notice Sets the rules that will be used to evaluate future proposals.
     * @param _rules string that outlines or references the location where the rules can be found.
     */
    function setRules(string memory _rules) public onlyOwner {
        // Set reference to the rules for the Optimistic Governor
        require(bytes(_rules).length > 0, "Rules can not be empty");
        rules = _rules;
        emit SetRules(_rules);
    }

    /**
     * @notice Sets the liveness for future proposals. This is the amount of delay before a proposal is approved by
     * default.
     * @param _liveness liveness to set in seconds.
     */
    function setLiveness(uint64 _liveness) public onlyOwner {
        // Set liveness for disputing proposed transactions.
        require(_liveness > 0, "Liveness can't be 0");
        require(_liveness < 5200 weeks, "Liveness must be less than 5200 weeks");
        liveness = _liveness;
        emit SetLiveness(_liveness);
    }

    /**
     * @notice Sets the identifier for future proposals.
     * @param _identifier identifier to set.
     */
    function setIdentifier(bytes32 _identifier) public onlyOwner {
        // Set identifier which is used along with the rules to determine if transactions are valid.
        require(_getIdentifierWhitelist().isIdentifierSupported(_identifier), "Identifier not supported");
        identifier = _identifier;
        emit SetIdentifier(_identifier);
    }

    /**
     * @notice Sets the Escalation Manager for future proposals.
     * @param _escalationManager address of the Escalation Manager, can be zero to disable this functionality.
     * @dev Only the owner can call this method. The provided address must conform to the Escalation Manager interface.
     * FullPolicyEscalationManager can be used, but within the context of this contract it should be used only for
     * whitelisting of proposers and disputers since Optimistic Governor is deleting disputed proposals.
     */
    function setEscalationManager(address _escalationManager) external onlyOwner {
        require(_isContract(_escalationManager) || _escalationManager == address(0), "EM is not a contract");
        escalationManager = _escalationManager;
        emit SetEscalationManager(_escalationManager);
    }

    /**
     * @notice This caches the most up-to-date Optimistic Oracle V3.
     * @dev If a new Optimistic Oracle V3 is added and this is run between a proposal's introduction and execution, the
     * proposal will become unexecutable.
     */
    function sync() external nonReentrant {
        _sync();
    }

    /**
     * @notice Makes a new proposal for transactions to be executed with an explanation argument.
     * @param transactions the transactions being proposed.
     * @param explanation Auxillary information that can be referenced to validate the proposal.
     * @dev Proposer must grant the contract collateral allowance at least to the bondAmount or result of getMinimumBond
     * from the Optimistic Oracle V3, whichever is greater.
     */
    function proposeTransactions(Transaction[] memory transactions, bytes memory explanation) external nonReentrant {
        // note: Optional explanation explains the intent of the transactions to make comprehension easier.
        uint256 time = getCurrentTime();
        address proposer = msg.sender;

        // Create proposal in memory to emit in an event.
        Proposal memory proposal;
        proposal.requestTime = time;

        // Add transactions to proposal in memory.
        for (uint256 i = 0; i < transactions.length; i++) {
            require(transactions[i].to != address(0), "The `to` address cannot be 0x0");
            // If the transaction has any data with it the recipient must be a contract, not an EOA.
            if (transactions[i].data.length > 0) {
                require(_isContract(transactions[i].to), "EOA can't accept tx with data");
            }
        }
        proposal.transactions = transactions;

        // Create the proposal hash.
        bytes32 proposalHash = keccak256(abi.encode(transactions));

        // Add the proposal hash, explanation and rules to ancillary data.
        bytes memory claim = _constructClaim(proposalHash, explanation);

        // Check that the proposal is not already mapped to an assertionId, i.e., is not a duplicate.
        require(assertionIds[proposalHash] == bytes32(0), "Duplicate proposals not allowed");

        // Get the bond from the proposer and approve the required bond to be used by the Optimistic Oracle V3.
        // This will fail if the proposer has not granted the Optimistic Governor contract an allowance
        // of the collateral token equal to or greater than the totalBond.
        uint256 totalBond = getProposalBond();
        collateral.safeTransferFrom(proposer, address(this), totalBond);
        collateral.safeIncreaseAllowance(address(optimisticOracleV3), totalBond);

        // Assert that the proposal is correct at the Optimistic Oracle V3.
        bytes32 assertionId =
            optimisticOracleV3.assertTruth(
                claim, // claim containing proposalHash, explanation and rules.
                proposer, // asserter will receive back bond if the assertion is correct.
                address(this), // callbackRecipient is set to this contract for automated proposal deletion on disputes.
                escalationManager, // escalationManager (if set) used for whitelisting proposers / disputers.
                liveness, // liveness in seconds.
                collateral, // currency in which the bond is denominated.
                totalBond, // bond amount used to assert proposal.
                identifier, // identifier used to determine if the claim is correct at DVM.
                bytes32(0) // domainId is not set.
            );

        // Maps the proposal hash to the returned assertionId and vice versa.
        assertionIds[proposalHash] = assertionId;
        proposalHashes[assertionId] = proposalHash;

        emit TransactionsProposed(
            proposer,
            time,
            assertionId,
            proposal,
            proposalHash,
            explanation,
            rules,
            time + liveness
        );
    }

    /**
     * @notice Executes an approved proposal.
     * @param transactions the transactions being executed. These must exactly match those that were proposed.
     */
    function executeProposal(Transaction[] memory transactions) external nonReentrant {
        // Recreate the proposal hash from the inputs and check that it matches the stored proposal hash.
        bytes32 proposalHash = keccak256(abi.encode(transactions));

        // Get the original proposal assertionId.
        bytes32 assertionId = assertionIds[proposalHash];

        // This will reject the transaction if the proposal hash generated from the inputs does not have the associated
        // assertionId stored. This is possible when a) the transactions have not been proposed, b) transactions have
        // already been executed, c) the proposal was disputed or d) the proposal was deleted after Optimistic Oracle V3
        // upgrade.
        require(assertionId != bytes32(0), "Proposal hash does not exist");

        // Remove proposal hash and assertionId so transactions can not be executed again.
        delete assertionIds[proposalHash];
        delete proposalHashes[assertionId];

        // There is no need to check the assertion result as this point can be reached only for non-disputed assertions.
        // This will revert if the assertion has not been settled and can not currently be settled.
        optimisticOracleV3.settleAndGetAssertionResult(assertionId);

        // Execute the transactions.
        for (uint256 i = 0; i < transactions.length; i++) {
            Transaction memory transaction = transactions[i];

            require(
                exec(transaction.to, transaction.value, transaction.data, transaction.operation),
                "Failed to execute transaction"
            );
            emit TransactionExecuted(proposalHash, assertionId, i);
        }

        emit ProposalExecuted(proposalHash, assertionId);
    }

    /**
     * @notice Function to delete a proposal on an Optimistic Oracle V3 upgrade.
     * @param proposalHash the hash of the proposal to delete.
     * @dev In case of an Optimistic Oracle V3 upgrade, the proposal execution would be blocked as its related
     * assertionId would not be recognized by the new Optimistic Oracle V3. This function allows the proposal to be
     * deleted if detecting an Optimistic Oracle V3 upgrade so that transactions can be re-proposed if needed.
     */
    function deleteProposalOnUpgrade(bytes32 proposalHash) public nonReentrant {
        require(proposalHash != bytes32(0), "Invalid proposal hash");
        bytes32 assertionId = assertionIds[proposalHash];
        require(assertionId != bytes32(0), "Proposal hash does not exist");

        // Detect Optimistic Oracle V3 upgrade by checking if it has the matching assertionId.
        require(optimisticOracleV3.getAssertion(assertionId).asserter == address(0), "OOv3 upgrade not detected");

        // Remove proposal hash and assertionId so that transactions can be re-proposed if needed.
        delete assertionIds[proposalHash];
        delete proposalHashes[assertionId];

        emit ProposalDeleted(proposalHash, assertionId);
    }

    /**
     * @notice Callback to automatically delete a proposal that was disputed.
     * @param assertionId the identifier of the disputed assertion.
     */
    function assertionDisputedCallback(bytes32 assertionId) external {
        bytes32 proposalHash = proposalHashes[assertionId];

        // Callback should only be called by the Optimistic Oracle V3. Address would not match in case of contract
        // upgrade, thus try deleting the proposal through deleteProposalOnUpgrade function that should revert if
        // address mismatch was not caused by an Optimistic Oracle V3 upgrade.
        if (msg.sender == address(optimisticOracleV3)) {
            // Validate the assertionId through existence of non-zero proposalHash. This is the same check as in
            // deleteProposalOnUpgrade method that is called in the else branch.
            require(proposalHash != bytes32(0), "Invalid proposal hash");

            // Delete the disputed proposal and associated assertionId.
            delete assertionIds[proposalHash];
            delete proposalHashes[assertionId];

            emit ProposalDeleted(proposalHash, assertionId);
        } else deleteProposalOnUpgrade(proposalHash);
    }

    /**
     * @notice Callback function that is called by Optimistic Oracle V3 when an assertion is resolved.
     * @dev This function does nothing and is only here to satisfy the callback recipient interface.
     * @param assertionId The identifier of the assertion that was resolved.
     * @param assertedTruthfully Whether the assertion was resolved as truthful or not.
     */
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) external {}

    /**
     * @notice Gets the current time for this contract.
     * @dev This only exists so it can be overridden for testing.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    /**
     * @notice Getter function to check required collateral currency approval.
     * @return The amount of bond required to propose a transaction.
     */
    function getProposalBond() public view returns (uint256) {
        uint256 minimumBond = optimisticOracleV3.getMinimumBond(address(collateral));
        return minimumBond > bondAmount ? minimumBond : bondAmount;
    }

    // Gets the address of Collateral Whitelist from the Finder.
    function _getCollateralWhitelist() internal view returns (AddressWhitelistInterface) {
        return AddressWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    // Gets the address of Identifier Whitelist from the Finder.
    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    // Gets the address of Store contract from the Finder.
    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    // Caches the address of the Optimistic Oracle V3 from the Finder.
    function _sync() internal {
        address newOptimisticOracleV3 = finder.getImplementationAddress(OracleInterfaces.OptimisticOracleV3);
        if (newOptimisticOracleV3 != address(optimisticOracleV3)) {
            optimisticOracleV3 = OptimisticOracleV3Interface(newOptimisticOracleV3);
            emit OptimisticOracleChanged(newOptimisticOracleV3);
        }
    }

    // Checks if the address is a contract.
    function _isContract(address addr) internal view returns (bool) {
        return addr.code.length > 0;
    }

    // Constructs the claim that will be asserted at the Optimistic Oracle V3.
    function _constructClaim(bytes32 proposalHash, bytes memory explanation) internal view returns (bytes memory) {
        return
            abi.encodePacked(
                ClaimData.appendKeyValueBytes32("", PROPOSAL_HASH_KEY, proposalHash),
                ",",
                EXPLANATION_KEY,
                ':"',
                explanation,
                '",',
                RULES_KEY,
                ':"',
                rules,
                '"'
            );
    }
}
