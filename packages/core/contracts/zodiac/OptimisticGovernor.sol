// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.6;

// https://github.com/gnosis/zodiac/blob/master/contracts/core/Module.sol
import "@gnosis.pm/zodiac/contracts/core/Module.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../oracle/implementation/Constants.sol";
import "../oracle/interfaces/FinderInterface.sol";
import "../oracle/interfaces/OptimisticOracleInterface.sol";
import "../common/implementation/Lockable.sol";
import "../common/interfaces/AddressWhitelistInterface.sol";
import "../oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../common/implementation/AncillaryData.sol";
import "../oracle/interfaces/StoreInterface.sol";

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
    uint256 public bondAmount;
    string public rules;
    // This will usually be "ZODIAC" but a deployer may want to create a more specific identifier.
    bytes32 public identifier;
    OptimisticOracleInterface public optimisticOracle;

    int256 public constant PROPOSAL_VALID_RESPONSE = int256(1e18);

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

    // This maps proposal hashes to the proposal timestamps.
    mapping(bytes32 => uint256) public proposalHashes;

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
        bytes memory ancillaryData = AncillaryData.appendKeyValueBytes32("", PROPOSAL_HASH_KEY, proposalHash);

        // Check that the proposal is not already mapped to a proposal time, i.e., is not a duplicate.
        require(proposalHashes[proposalHash] == 0, "Duplicate proposals are not allowed");

        // Map the proposal hash to the current time.
        proposalHashes[proposalHash] = time;

        // Propose a set of transactions to the OO. If not disputed, they can be executed with executeProposal().
        // docs: https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/oracle/interfaces/OptimisticOracleInterface.sol
        optimisticOracle.requestPrice(identifier, time, ancillaryData, collateral, 0);
        uint256 totalBond = optimisticOracle.setBond(identifier, time, ancillaryData, bondAmount);
        optimisticOracle.setCustomLiveness(identifier, time, ancillaryData, liveness);

        // Get the bond from the proposer and approve the bond and final fee to be used by the oracle.
        // This will fail if the proposer has not granted the OptimisticGovernor contract an allowance
        // of the collateral token equal to or greater than the totalBond.
        collateral.safeTransferFrom(msg.sender, address(this), totalBond);
        collateral.safeIncreaseAllowance(address(optimisticOracle), totalBond);

        optimisticOracle.proposePriceFor(
            msg.sender,
            address(this),
            identifier,
            time,
            ancillaryData,
            PROPOSAL_VALID_RESPONSE
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

        // Add the proposal hash to ancillary data.
        bytes memory ancillaryData = AncillaryData.appendKeyValueBytes32("", PROPOSAL_HASH_KEY, _proposalHash);

        // This will reject the transaction if the proposal hash generated from the inputs does not match the stored proposal hash.
        require(proposalHashes[_proposalHash] != 0, "proposal hash does not exist");

        // Get the original proposal time.
        uint256 _originalTime = proposalHashes[_proposalHash];

        // You can not execute a proposal that has been disputed at some point in the past.
        require(
            optimisticOracle.getRequest(address(this), identifier, _originalTime, ancillaryData).disputer == address(0),
            "Must call deleteDisputedProposal instead"
        );

        // Remove proposal hash so transactions can not be executed again.
        delete proposalHashes[_proposalHash];

        // This will revert if the price has not been settled and can not currently be settled.
        int256 price = optimisticOracle.settleAndGetPrice(identifier, _originalTime, ancillaryData);
        require(price == PROPOSAL_VALID_RESPONSE, "Proposal was rejected");

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
        require(proposalHashes[_proposalHash] != 0, "Proposal does not exist");

        delete proposalHashes[_proposalHash];
        emit ProposalDeleted(_proposalHash, msg.sender, "DeletedByOwner");
    }

    /**
     * @notice Method to allow anyone to delete a proposal that was rejected.
     * @param _proposalHash the hash of the proposal being deleted.
     */
    function deleteRejectedProposal(bytes32 _proposalHash) external {
        // Check that proposal exists and was not already deleted.
        require(proposalHashes[_proposalHash] != 0, "Proposal does not exist");

        // Add the proposal hash to ancillary data.
        bytes memory ancillaryData = AncillaryData.appendKeyValueBytes32("", PROPOSAL_HASH_KEY, _proposalHash);

        // Get the original proposal time.
        uint256 _originalTime = proposalHashes[_proposalHash];

        // This will revert if the price has not settled.
        int256 price = optimisticOracle.settleAndGetPrice(identifier, _originalTime, ancillaryData);

        // Check that proposal was rejected.
        require(price != PROPOSAL_VALID_RESPONSE, "Proposal was not rejected");

        // Delete the proposal.
        delete proposalHashes[_proposalHash];
        emit ProposalDeleted(_proposalHash, msg.sender, "Rejected");
    }

    /**
     * @notice Method to allow anyone to delete a proposal that was disputed.
     * @param _proposalHash the hash of the proposal being deleted.
     */
    function deleteDisputedProposal(bytes32 _proposalHash) external {
        // Check that proposal exists and was not already deleted.
        require(proposalHashes[_proposalHash] != 0, "Proposal does not exist");

        // Add the proposal hash to ancillary data.
        bytes memory ancillaryData = AncillaryData.appendKeyValueBytes32("", PROPOSAL_HASH_KEY, _proposalHash);

        // Get the original proposal time.
        uint256 _originalTime = proposalHashes[_proposalHash];

        // Get the state of the proposal.
        OptimisticOracleInterface.Request memory request =
            optimisticOracle.getRequest(address(this), identifier, _originalTime, ancillaryData);

        // Check that proposal was disputed.
        require(request.disputer != address(0), "Proposal was not disputed");

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
        optimisticOracle = _getOptimisticOracle();
    }

    function _getOptimisticOracle() private view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }

    function _isContract(address addr) private view returns (bool) {
        return addr.code.length > 0;
    }
}
