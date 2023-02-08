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

import "../../common/implementation/Lockable.sol";
import "../../common/interfaces/AddressWhitelistInterface.sol";
import "../../common/implementation/AncillaryData.sol";

contract OptimisticGovernor is Module, Lockable {
    using SafeERC20 for IERC20;

    event OptimisticGovernorDeployed(address indexed owner, address indexed avatar, address target);

    event TransactionsProposed(
        address indexed proposer,
        uint256 indexed proposalTime,
        Proposal proposal,
        bytes32 proposalHash,
        bytes explanation,
        uint256 challengeWindowEnds
    );

    event TransactionExecuted(bytes32 indexed proposalHash, uint256 indexed transactionIndex);

    event ProposalDeleted(bytes32 indexed proposalHash, address indexed sender, bytes32 indexed status);

    event SetBond(IERC20 indexed collateral, uint256 indexed bondAmount);

    event SetCollateral(IERC20 indexed collateral);

    event SetRules(string indexed rules);

    event SetLiveness(uint64 indexed liveness);

    event SetIdentifier(bytes32 indexed identifier);

    // Since finder is set during setUp, you will need to deploy a new Optimistic Governor module if this address need to be changed in the future.
    FinderInterface public immutable finder;

    IERC20 public collateral;
    uint64 public liveness;
    // Extra bond in addition to the final fee for the collateral type.
    // TODO: check how finalFee is handled as OA does not explicitly require it.
    uint256 public bondAmount;
    string public rules;
    // This will usually be "ZODIAC" but a deployer may want to create a more specific identifier.
    // TODO: might require OA compatable identifier.
    bytes32 public identifier;
    OptimisticAsserterInterface public optimisticAsserter;

    bytes public constant PROPOSAL_HASH_KEY = "proposalHash";

    struct Transaction {
        address to;
        Enum.Operation operation;
        uint256 value;
        bytes data;
    }

    struct Proposal {
        Transaction[] transactions;
        uint256 requestTime;
    }

    // This maps proposal hashes to the assertionIds.
    mapping(bytes32 => bytes32) public proposalHashes;

    /**
     * @notice Construct Optimistic Governor module.
     * @param _finder Finder address.
     * @param _owner Address of the owner.
     * @param _collateral Address of the ERC20 collateral used for bonds.
     * @param _bondAmount Additional bond required, beyond the final fee.
     * @param _rules Reference to the rules for the Gnosis Safe (e.g., IPFS hash or URI).
     * @param _identifier The approved identifier to be used with the contract, usually "ZODIAC".
     * @param _liveness The period, in seconds, in which a proposal can be disputed.
     * @dev if the bondAmount is zero, there will be no reward for disputers, reducing incentives to dispute invalid proposals.
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
        require(_finder != address(0), "finder address can not be empty");
        finder = FinderInterface(_finder);
        setUp(initializeParams);
    }

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
        // ERC20 token to be used as collateral (must be approved by UMA Store contract).
        require(_getCollateralWhitelist().isOnWhitelist(address(_collateral)), "bond token not supported");
        collateral = _collateral;

        // Value of the bond required for proposals, in addition to the final fee. A bond of zero is
        // acceptable, in which case the Optimistic Oracle will require the final fee as the bond.
        bondAmount = _bondAmount;
        emit SetBond(_collateral, _bondAmount);
    }

    /**
     * @notice Sets the rules that will be used to evaluate future proposals.
     * @param _rules string that outlines or references the location where the rules can be found.
     */
    function setRules(string memory _rules) public onlyOwner {
        // Set reference to the rules for the avatar (e.g. an IPFS hash or URI).
        require(bytes(_rules).length > 0, "rules can not be empty");
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
        require(_liveness > 0, "liveness can't be 0");
        require(_liveness < 5200 weeks, "liveness must be less than 5200 weeks");
        liveness = _liveness;
        emit SetLiveness(_liveness);
    }

    /**
     * @notice Sets the identifier for future proposals.
     * @dev Changing this after a proposal is made but before it is executed will make it unexecutable.
     * @param _identifier identifier to set.
     */
    function setIdentifier(bytes32 _identifier) public onlyOwner {
        // Set identifier which is used along with the rules to determine if transactions are valid.
        require(_getIdentifierWhitelist().isIdentifierSupported(_identifier), "identifier not supported");
        identifier = _identifier;
        emit SetIdentifier(_identifier);
    }

    /**
     * @notice This pulls in the most up-to-date Optimistic Oracle.
     * @dev If a new OptimisticOracle is added and this is run between a proposal's introduction and execution, the
     * proposal will become unexecutable.
     */
    function sync() external nonReentrant {
        _sync();
    }

    /**
     * @notice Makes a new proposal for transactions to be executed with an "explanation" argument.
     * @param _transactions the transactions being proposed.
     * @param _explanation Auxillary information that can be referenced to validate the proposal.
     * @dev Proposer must grant the contract collateral allowance equal or greater than the totalBond.
     */
    function proposeTransactions(Transaction[] memory _transactions, bytes memory _explanation) external nonReentrant {
        // note: Optional explanation explains the intent of the transactions to make comprehension easier.
        uint256 time = getCurrentTime();
        address proposer = msg.sender;

        // TODO: get rid of Proposal struct since time is not passed to assertion.
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

        // Add the proposal hash to ancillary data.
        bytes memory claim = AncillaryData.appendKeyValueBytes32("", PROPOSAL_HASH_KEY, proposalHash);

        // Check that the proposal is not already mapped to an assertionId, i.e., is not a duplicate.
        require(proposalHashes[proposalHash] == bytes32(0), "Duplicate proposals are not allowed");

        // Check the minimum required bond and use that if it is greater than the bondAmount.
        uint256 minimumBond = optimisticAsserter.getMinimumBond(address(collateral));
        uint256 totalBond = minimumBond > bondAmount ? minimumBond : bondAmount;

        // Get the bond from the proposer and approve the required bond to be used by the optimistic asserter.
        // This will fail if the proposer has not granted the OptimisticGovernor contract an allowance
        // of the collateral token equal to or greater than the totalBond.
        collateral.safeTransferFrom(msg.sender, address(this), totalBond);
        collateral.safeIncreaseAllowance(address(optimisticAsserter), totalBond);

        // Assert that the proposal is correct to the OA. If not disputed, they can be executed with executeProposal().
        // Maps the proposal hash to the returned assertionId.
        proposalHashes[proposalHash] = optimisticAsserter.assertTruth(
            claim, // claim containing proposalHash.
            proposer, // asserter will receive back bond if the assertion is correct.
            address(0), // callbackRecipient is not set. TODO: consider using for automated proposal deletion.
            address(0), // escalationManager is not set.
            liveness, // liveness in seconds.
            collateral, // currency in which the bond is denominated.
            totalBond, // bond amount, will revert if it is less than required by the Optimistic Asserter.
            identifier, // identifier used to determine if the claim is correct at DVM.
            bytes32(0) // domainId is not set.
        );

        uint256 challengeWindowEnds = time + liveness;

        emit TransactionsProposed(proposer, time, proposal, proposalHash, _explanation, challengeWindowEnds);
    }

    /**
     * @notice Executes an approved proposal.
     * @param _transactions the transactions being executed. These must exactly match those that were proposed.
     */
    function executeProposal(Transaction[] memory _transactions) external payable nonReentrant {
        // Recreate the proposal hash from the inputs and check that it matches the stored proposal hash.
        bytes32 _proposalHash = keccak256(abi.encode(_transactions));

        // This will reject the transaction if the proposal hash generated from the inputs does not match the stored proposal hash.
        require(proposalHashes[_proposalHash] != bytes32(0), "proposal hash does not exist");

        // Get the original proposal assertionId.
        bytes32 assertionId = proposalHashes[_proposalHash];

        // You can not execute a proposal that has been disputed at some point in the past.
        // TODO: replace with getAssertion, but might be redundant if using EM discarding disputed assertions.
        // TODO: alternative to EM could rely on callback to delete disputed proposal.
        require(
            optimisticAsserter.getAssertion(assertionId).disputer == address(0),
            "Must call deleteDisputedProposal instead"
        );

        // Remove proposal hash so transactions can not be executed again.
        delete proposalHashes[_proposalHash];

        // This will revert if the assertion has not been settled and can not currently be settled.
        require(optimisticAsserter.settleAndGetAssertionResult(assertionId), "Proposal was rejected");

        for (uint256 i = 0; i < _transactions.length; i++) {
            Transaction memory transaction = _transactions[i];

            require(
                exec(transaction.to, transaction.value, transaction.data, transaction.operation),
                "Failed to execute the transaction"
            );
            emit TransactionExecuted(_proposalHash, i);
        }
    }

    /**
     * @notice Method to allow the owner to delete a particular proposal.
     * @param _proposalHash the hash of the proposal being deleted.
     */
    function deleteProposal(bytes32 _proposalHash) external onlyOwner {
        // Check that proposal exists and was not already deleted.
        require(proposalHashes[_proposalHash] != bytes32(0), "Proposal does not exist");

        delete proposalHashes[_proposalHash];
        emit ProposalDeleted(_proposalHash, msg.sender, "DeletedByOwner");
    }

    /**
     * @notice Method to allow anyone to delete a proposal that was rejected.
     * @param _proposalHash the hash of the proposal being deleted.
     */
    // TODO: This can be replaced with assertionResolvedCallback from OA. This requires mapping assertionId to proposalHash.
    function deleteRejectedProposal(bytes32 _proposalHash) external {
        // Check that proposal exists and was not already deleted.
        require(proposalHashes[_proposalHash] != bytes32(0), "Proposal does not exist");

        // Get the original proposal assertionId.
        bytes32 assertionId = proposalHashes[_proposalHash];

        // This will revert if the assertion has not been settled and cannot currently be settled.
        bool assertionResult = optimisticAsserter.settleAndGetAssertionResult(assertionId);

        // Check that proposal was rejected.
        require(!assertionResult, "Proposal was not rejected");

        // Delete the proposal.
        delete proposalHashes[_proposalHash];
        emit ProposalDeleted(_proposalHash, msg.sender, "Rejected");
    }

    /**
     * @notice Method to allow anyone to delete a proposal that was disputed.
     * @param _proposalHash the hash of the proposal being deleted.
     */
    // TODO: This can be replaced with assertionDisputedCallback from OA. This requires mapping assertionId to proposalHash.
    function deleteDisputedProposal(bytes32 _proposalHash) external {
        // Check that proposal exists and was not already deleted.
        require(proposalHashes[_proposalHash] != bytes32(0), "Proposal does not exist");

        // Get the original proposal assertionId.
        bytes32 assertionId = proposalHashes[_proposalHash];

        // Check that proposal was disputed.
        require(optimisticAsserter.getAssertion(assertionId).disputer != address(0), "Proposal was not disputed");

        // Delete the proposal.
        delete proposalHashes[_proposalHash];
        emit ProposalDeleted(_proposalHash, msg.sender, "Disputed");
    }

    /**
     * @notice Gets the current time for this contract.
     * @dev This only exists so it can be overridden for testing.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelistInterface) {
        return AddressWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    function _sync() internal {
        optimisticAsserter = _getOptimisticAsserter();
    }

    function _getOptimisticAsserter() private view returns (OptimisticAsserterInterface) {
        return OptimisticAsserterInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticAsserter));
    }

    function _isContract(address addr) private view returns (bool) {
        return addr.code.length > 0;
    }
}
