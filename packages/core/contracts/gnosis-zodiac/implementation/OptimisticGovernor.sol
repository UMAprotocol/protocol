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

import "../../optimistic-asserter/interfaces/OptimisticAsserterInterface.sol";
import "../../optimistic-asserter/interfaces/OptimisticAsserterCallbackRecipientInterface.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/interfaces/AddressWhitelistInterface.sol";
import "../../common/implementation/AncillaryData.sol";

/**
 * @title Optimistic Governor
 * @notice A contract that allows optimistic governance of a set of transactions. The contract can be used to propose
 * transactions that can be challenged by anyone. If the challenge is not resolved within a certain liveness period, the
 * transactions can be executed.
 */
contract OptimisticGovernor is OptimisticAsserterCallbackRecipientInterface, Module, Lockable {
    using SafeERC20 for IERC20;

    event OptimisticGovernorDeployed(address indexed owner, address indexed avatar, address target);

    event TransactionsProposed(
        address indexed proposer,
        uint256 indexed proposalTime,
        bytes32 indexed assertionId,
        Proposal proposal,
        bytes32 proposalHash,
        bytes explanation,
        uint256 challengeWindowEnds
    );

    event TransactionExecuted(
        bytes32 indexed proposalHash,
        bytes32 indexed assertionId,
        uint256 indexed transactionIndex
    );

    event ProposalExecuted(bytes32 indexed proposalHash, bytes32 indexed assertionId);

    event ProposalDeleted(bytes32 indexed proposalHash, bytes32 indexed assertionId);

    event SetBond(IERC20 indexed collateral, uint256 indexed bondAmount);

    event SetCollateral(IERC20 indexed collateral);

    event SetRules(string rules);

    event SetLiveness(uint64 indexed liveness);

    event SetIdentifier(bytes32 indexed identifier);

    event SetEscalationManager(address indexed escalationManager);

    FinderInterface public immutable finder; // Finder used to discover other UMA ecosystem contracts.

    IERC20 public collateral; // Collateral currency used to assert proposed transactions.
    uint64 public liveness; // The amount of time to dispute proposed transactions before they can be executed.
    uint256 public bondAmount; // Configured amount of collateral currency to make assertions for proposed transactions.
    string public rules; // Rules for the Optimistic Governor.
    bytes32 public identifier; // Identifier used to request price from the DVM, compatible with Optimistic Asserter.
    OptimisticAsserterInterface public optimisticAsserter; // Optimistic Asserter contract used to assert proposed transactions.
    address public escalationManager; // Optional Escalation Manager contract to whitelist proposers / disputers.

    // Keys for assertion claim data.
    bytes public constant PROPOSAL_HASH_KEY = "proposalHash";
    bytes public constant EXPLANATION_KEY = "explanation";

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

    mapping(bytes32 => bytes32) public proposalHashes; // Maps proposal hashes to assertionIds.
    mapping(bytes32 => bytes32) public assertionIds; // Maps assertionIds to proposal hashes.

    /**
     * @notice Construct Optimistic Governor module.
     * @param _finder Finder address.
     * @param _owner Address of the owner.
     * @param _collateral Address of the ERC20 collateral used for bonds.
     * @param _bondAmount Amount of collateral currency to make assertions for proposed transactions
     * @param _rules Reference to the rules for the Optimistic Governor.
     * @param _identifier The approved identifier to be used with the contract, compatible with Optimistic Asserter.
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
        // Optimistic Asserter is higher this contract will attempt to pull the required bond amount.
        bondAmount = _bondAmount;
        emit SetBond(_collateral, _bondAmount);
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
        escalationManager = _escalationManager;
        emit SetEscalationManager(_escalationManager);
    }

    /**
     * @notice This caches the most up-to-date Optimistic Asserter.
     * @dev If a new Optimistic Asserter is added and this is run between a proposal's introduction and execution, the
     * proposal will become unexecutable.
     */
    function sync() external nonReentrant {
        _sync();
    }

    /**
     * @notice Makes a new proposal for transactions to be executed with an explanation argument.
     * @param _transactions the transactions being proposed.
     * @param _explanation Auxillary information that can be referenced to validate the proposal.
     * @dev Proposer must grant the contract collateral allowance at least to the bondAmount or result of getMinimumBond
     * from the Optimistic Asserter, whichever is greater.
     */
    function proposeTransactions(Transaction[] memory _transactions, bytes memory _explanation) external nonReentrant {
        // note: Optional explanation explains the intent of the transactions to make comprehension easier.
        uint256 time = getCurrentTime();
        address proposer = msg.sender;

        // Create proposal in memory to emit in an event.
        Proposal memory proposal;
        proposal.requestTime = time;

        // Add transactions to proposal in memory.
        for (uint256 i = 0; i < _transactions.length; i++) {
            require(_transactions[i].to != address(0), "The `to` address cannot be 0x0");
            // If the transaction has any data with it the recipient must be a contract, not an EOA.
            if (_transactions[i].data.length > 0) {
                require(_isContract(_transactions[i].to), "EOA can't accept tx with data");
            }
        }
        proposal.transactions = _transactions;

        // Create the proposal hash.
        bytes32 proposalHash = keccak256(abi.encode(_transactions));

        // Add the proposal hash and explanation to ancillary data.
        bytes memory claim = _constructClaim(proposalHash, _explanation);

        // Check that the proposal is not already mapped to an assertionId, i.e., is not a duplicate.
        require(proposalHashes[proposalHash] == bytes32(0), "Duplicate proposals not allowed");

        // Get the bond from the proposer and approve the required bond to be used by the Optimistic Asserter.
        // This will fail if the proposer has not granted the Optimistic Governor contract an allowance
        // of the collateral token equal to or greater than the totalBond.
        uint256 totalBond = getProposalBond();
        collateral.safeTransferFrom(msg.sender, address(this), totalBond);
        collateral.safeIncreaseAllowance(address(optimisticAsserter), totalBond);

        // Assert that the proposal is correct at the Optimistic Asserter.
        bytes32 assertionId =
            optimisticAsserter.assertTruth(
                claim, // claim containing proposalHash and explanation.
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
        proposalHashes[proposalHash] = assertionId;
        assertionIds[assertionId] = proposalHash;

        emit TransactionsProposed(proposer, time, assertionId, proposal, proposalHash, _explanation, time + liveness);
    }

    /**
     * @notice Executes an approved proposal.
     * @param _transactions the transactions being executed. These must exactly match those that were proposed.
     */
    function executeProposal(Transaction[] memory _transactions) external payable nonReentrant {
        // Recreate the proposal hash from the inputs and check that it matches the stored proposal hash.
        bytes32 _proposalHash = keccak256(abi.encode(_transactions));

        // This will reject the transaction if the proposal hash generated from the inputs does not match the stored
        // proposal hash. This is possible when a) the transactions have not been proposed, b) transactions have already
        // been executed, c) the proposal was disputed or d) the proposal was deleted after Optimistic Asserter upgrade.
        require(proposalHashes[_proposalHash] != bytes32(0), "Proposal hash does not exist");

        // Get the original proposal assertionId.
        bytes32 assertionId = proposalHashes[_proposalHash];

        // Remove proposal hash and assertionId so transactions can not be executed again.
        delete proposalHashes[_proposalHash];
        delete assertionIds[assertionId];

        // There is no need to check the assertion result as this point can be reached only for non-disputed assertions.
        // This will revert if the assertion has not been settled and can not currently be settled.
        optimisticAsserter.settleAndGetAssertionResult(assertionId);

        // Execute the transactions.
        for (uint256 i = 0; i < _transactions.length; i++) {
            Transaction memory transaction = _transactions[i];

            require(
                exec(transaction.to, transaction.value, transaction.data, transaction.operation),
                "Failed to execute transaction"
            );
            emit TransactionExecuted(_proposalHash, assertionId, i);
        }

        emit ProposalExecuted(_proposalHash, assertionId);
    }

    /**
     * @notice Function to delete a proposal on an Optimistic Asserter upgrade.
     * @param _proposalHash the hash of the proposal to delete.
     * @dev In case of an Optimistic Asserter upgrade, the proposal execution would be blocked as its related
     * assertionId would not be recognized by the new Optimistic Asserter. This function allows the proposal to be
     * deleted if detecting an Optimistic Asserter upgrade so that transactions can be re-proposed if needed.
     */
    function deleteProposalOnUpgrade(bytes32 _proposalHash) public nonReentrant {
        require(_proposalHash != bytes32(0), "Invalid proposal hash");
        bytes32 assertionId = proposalHashes[_proposalHash];
        require(assertionId != bytes32(0), "Proposal hash does not exist");

        // Detect Optimistic Asserter upgrade by checking if it has the matching assertionId.
        require(optimisticAsserter.getAssertion(assertionId).asserter == address(0), "OA upgrade not detected");

        // Remove proposal hash and assertionId so that transactions can be re-proposed if needed.
        delete proposalHashes[_proposalHash];
        delete assertionIds[assertionId];

        emit ProposalDeleted(_proposalHash, assertionId);
    }

    /**
     * @notice Callback to automatically delete a proposal that was disputed.
     * @param assertionId the identifier of the disputed assertion.
     */
    function assertionDisputedCallback(bytes32 assertionId) external {
        // In order to optimize for happy path, the assertionId is validated for potential spoofing only in the
        // deleteProposalOnUpgrade call. Genuine Optimistic Asserter should always pass a valid assertionId that has a
        // matching proposalHash in this contract.
        bytes32 proposalHash = assertionIds[assertionId];

        // Callback should only be called by the Optimistic Asserter. Address would not match in case of contract
        // upgrade, thus try deleting the proposal through deleteProposalOnUpgrade function that should revert if
        // address mismatch was not caused by an Optimistic Asserter upgrade.
        if (msg.sender == address(optimisticAsserter)) {
            // Delete the disputed proposal and associated assertionId.
            delete proposalHashes[proposalHash];
            delete assertionIds[assertionId];

            emit ProposalDeleted(proposalHash, assertionId);
        } else deleteProposalOnUpgrade(proposalHash);
    }

    /**
     * @notice Callback function that is called by Optimistic Asserter when an assertion is resolved.
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
        uint256 minimumBond = optimisticAsserter.getMinimumBond(address(collateral));
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

    // Caches the address of the Optimistic Asserter from the Finder.
    function _sync() internal {
        optimisticAsserter = OptimisticAsserterInterface(
            finder.getImplementationAddress(OracleInterfaces.OptimisticAsserter)
        );
    }

    // Checks if the address is a contract.
    function _isContract(address addr) internal view returns (bool) {
        return addr.code.length > 0;
    }

    // Constructs the claim that will be asserted at the Optimistic Asserter.
    // TODO: consider adding rules.
    function _constructClaim(bytes32 _proposalHash, bytes memory _explanation) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                AncillaryData.appendKeyValueBytes32("", PROPOSAL_HASH_KEY, _proposalHash),
                ",",
                EXPLANATION_KEY,
                ":",
                _explanation
            );
    }
}
