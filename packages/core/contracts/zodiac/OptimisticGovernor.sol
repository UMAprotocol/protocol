// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.6;

// https://github.com/gnosis/zodiac/blob/master/contracts/core/Module.sol
import "@gnosis.pm/zodiac/contracts/core/Module.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../oracle/implementation/Constants.sol";
import "../oracle/interfaces/FinderInterface.sol";
import "../oracle/interfaces/OptimisticOracleInterface.sol";
import "../oracle/implementation/OptimisticOracle.sol";
import "../common/implementation/Lockable.sol";
import "../common/interfaces/AddressWhitelistInterface.sol";
import "../oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../common/implementation/AncillaryData.sol";
import "../oracle/interfaces/StoreInterface.sol";

contract OptimisticGovernor is Module, Lockable {
    using SafeERC20 for IERC20;

    event OptimisticGovernorDeployed(address indexed owner, address indexed avatar, address target);

    event SetCollateralAndBond(address indexed collateral, uint256 indexed bond);

    event SetRules(string indexed rules);

    event SetLiveness(uint64 indexed liveness);

    event SetIdentifier(bytes32 indexed identifier);

    event TransactionsProposed(
        uint256 indexed proposalId,
        address indexed proposer,
        uint256 indexed proposalTime,
        Proposal proposal,
        bytes explanation
    );

    event TransactionExecuted(uint256 indexed proposalId, uint256 indexed transactionIndex);

    event ProposalDeleted(uint256 indexed proposalId);

    // Since finder is set during setUp, you will need to deploy a new Optimistic Governor module if this address need to be changed in the future.
    FinderInterface public finder;

    IERC20 public collateral;
    uint64 public liveness;
    // Extra bond in addition to the final fee for the collateral type.
    uint256 public bond;
    string public rules;
    // This will usually be "ZODIAC" but a deployer may want to create a more specific identifier.
    bytes32 public identifier;
    OptimisticOracleInterface public optimisticOracle;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        Enum.Operation operation;
    }

    struct Proposal {
        Transaction[] transactions;
        uint256 requestTime;
    }

    mapping(uint256 => bytes32) public proposalHashes;
    uint256 public prevProposalId;

    /**
     * @notice Construct Optimistic Governor module.
     * @param _finder Finder address.
     * @param _owner Address of the owner.
     * @param _collateral Address of the ERC20 collateral used for bonds.
     * @param _bond Bond required (must be at least as large as final fee for collateral type).
     * @param _rules Reference to the rules for the Gnosis Safe (e.g., IPFS hash or URI).
     * @param _identifier The approved identifier to be used with the contract, usually "ZODIAC".
     * @param _liveness The period, in seconds, in which a proposal can be disputed.
     */
    constructor(
        address _finder,
        address _owner,
        address _collateral,
        uint256 _bond,
        string memory _rules,
        bytes32 _identifier,
        uint64 _liveness
    ) {
        bytes memory initializeParams = abi.encode(_finder, _owner, _collateral, _bond, _rules, _identifier, _liveness);
        setUp(initializeParams);
    }

    function setUp(bytes memory initializeParams) public override initializer {
        __Ownable_init();
        (
            address _finder,
            address _owner,
            address _collateral,
            uint256 _bond,
            string memory _rules,
            bytes32 _identifier,
            uint64 _liveness
        ) = abi.decode(initializeParams, (address, address, address, uint256, string, bytes32, uint64));
        require(_finder != address(0), "finder address can not be empty");
        finder = FinderInterface(_finder);
        setCollateralAndBond(_collateral, _bond);
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
     * @param _bond amount of the bond token that will need to be paid for future proposals.
     */
    function setCollateralAndBond(address _collateral, uint256 _bond) public onlyOwner {
        // ERC20 token to be used as collateral (must be approved by UMA Store contract).
        require(_getCollateralWhitelist().isOnWhitelist(address(_collateral)), "bond token not supported");
        collateral = IERC20(_collateral);

        // Value of the bond required for proposals, in addition to the final fee. A bond of zero is
        // acceptable, in which case the Optimistic Oracle will require the final fee as the bond.
        bond = _bond;

        emit SetCollateralAndBond(_collateral, _bond);
    }

    /**
     * @notice Sets the rules that will be used to evaluate future proposals.
     * @param _rules string that outlines or references the location where the rules can be found.
     */
    function setRules(string memory _rules) public onlyOwner {
        // Set reference to the rules for the avatar (e.g. an IPFS hash or URI).
        require(bytes(_rules).length > 0, "rules can not be empty");
        rules = _rules;

        emit SetRules(rules);
    }

    /**
     * @notice Sets the liveness for future proposals. This is the amount of delay before a proposal is approved by
     * default.
     * @param _liveness liveness to set in seconds.
     */
    function setLiveness(uint64 _liveness) public onlyOwner {
        // Set liveness for disputing proposed transactions.
        require(_liveness > 0, "liveness can't be 0");
        require(_liveness < 3144960000, "liveness can't be longer than 5200 weeks");
        liveness = _liveness;

        emit SetLiveness(liveness);
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

        emit SetIdentifier(identifier);
    }

    /**
     * @notice This pulls in the most up-to-date Optimistic Oracle.
     * @dev If a new OptimisticOracle is added and this is run between a proposals introduction and execution, the
     * proposal will become unexecutable.
     */
    function sync() public nonReentrant {
        // Sync the oracle contract addresses as well as the final fee.
        _sync();
    }

    /**
     * @notice Makes a new proposal for transactions to be executed with an "explanation" argument.
     * @param _transactions the transactions being proposed.
     * @param _explanation Auxillary information that can be referenced to validate the proposal.
     */
    function proposeTransactions(Transaction[] memory _transactions, bytes memory _explanation) public nonReentrant {
        // note: Optional explanation explains the intent of the transactions to make comprehension easier.
        uint256 id = prevProposalId + 1;
        prevProposalId = id;
        uint256 time = getCurrentTime();
        address proposer = msg.sender;

        // Create proposal in memory to emit in an event.
        Proposal memory proposal;
        proposal.requestTime = time;

        // Construct the ancillary data.
        bytes memory ancillaryData = AncillaryData.appendKeyValueUint("", "id", id);

        // Add transactions to proposal in memory.
        for (uint256 i = 0; i < _transactions.length; i++) {
            require(_transactions[i].to != address(0), "The `to` address cannot be 0x0");
            // If the transaction has any data with it the recipient must be a contract, not an EOA.
            if (_transactions[i].data.length > 0) {
                require(_isContract(_transactions[i].to), "EOA can't accept tx with data");
            }
        }
        proposal.transactions = _transactions;

        // proposalHashes[id] = keccak256(abi.encodePacked(proposalData));
        proposalHashes[id] = keccak256(abi.encode(_transactions));

        // Propose a set of transactions to the OO. If not disputed, they can be executed with executeProposal().
        // docs: https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/oracle/interfaces/OptimisticOracleInterface.sol
        optimisticOracle.requestPrice(identifier, time, ancillaryData, collateral, 0);
        uint256 totalBond = optimisticOracle.setBond(identifier, time, ancillaryData, bond);
        optimisticOracle.setCustomLiveness(identifier, time, ancillaryData, liveness);

        // Get the bond from the proposer and approve the bond and final fee to be used by the oracle.
        collateral.safeTransferFrom(msg.sender, address(this), totalBond);
        collateral.safeIncreaseAllowance(address(optimisticOracle), totalBond);

        optimisticOracle.proposePriceFor(msg.sender, address(this), identifier, time, ancillaryData, int256(1e18));

        emit TransactionsProposed(id, proposer, time, proposal, _explanation);
    }

    /**
     * @notice Executes an approved proposal.
     * @param _proposalId the id of the proposal being executed.
     * @param _transactions the transactions being executed. These must exactly match those that were proposed.
     * @param _originalTime the timestamp of the original proposal.
     */
    function executeProposal(
        uint256 _proposalId,
        Transaction[] memory _transactions,
        uint256 _originalTime
    ) public payable nonReentrant {
        // Recreate the proposal hash from the inputs and check that it matches the stored proposal hash.
        uint256 id = _proposalId;

        // Construct the ancillary data.
        bytes memory ancillaryData = AncillaryData.appendKeyValueUint("", "id", id);

        // This will reject the transaction if the proposal hash generated from the inputs does not match the stored proposal hash.
        // require(proposalHashes[id] == keccak256(abi.encodePacked(proposalData)), "proposal hash does not match");
        require(proposalHashes[id] == keccak256(abi.encode(_transactions)), "proposal hash does not match");

        // Remove proposal hash so transactions can not be executed again.
        delete proposalHashes[id];

        // This will revert if the price has not settled.
        int256 price = optimisticOracle.settleAndGetPrice(identifier, _originalTime, ancillaryData);
        require(price == int256(1e18), "Proposal was rejected");

        for (uint256 i = 0; i < _transactions.length; i++) {
            Transaction memory transaction = _transactions[i];

            require(
                exec(transaction.to, transaction.value, transaction.data, transaction.operation),
                "Failed to execute the transaction"
            );
            emit TransactionExecuted(_proposalId, i);
        }
    }

    /**
     * @notice Method to allow the owner to delete a particular proposal.
     * @param _proposalId the id of the proposal being deleted.
     */
    function deleteProposal(uint256 _proposalId) public onlyOwner {
        delete proposalHashes[_proposalId];
        emit ProposalDeleted(_proposalId);
    }

    /**
     * @notice Method to allow anyone to delete a proposal that was rejected.
     * @param _proposalId the id of the proposal being deleted.
     * @param _originalTime the id of the proposal being deleted.
     */
    function deleteRejectedProposal(uint256 _proposalId, uint256 _originalTime) public {
        // Construct the ancillary data.
        bytes memory ancillaryData = AncillaryData.appendKeyValueUint("", "id", _proposalId);

        // This will revert if the price has not settled.
        int256 price = optimisticOracle.settleAndGetPrice(identifier, _originalTime, ancillaryData);

        // Check that proposal was rejected.
        require(price != int256(1e18), "Proposal was not rejected");

        // Delete the proposal.
        delete proposalHashes[_proposalId];
        emit ProposalDeleted(_proposalId);
    }

    /**
     * @notice Gets the current time for this contract.
     * @dev This only exists so it can be overriden for testing.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    function _getOptimisticOracle() private view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }

    function _isContract(address addr) private view returns (bool isContract) {
        return addr.code.length > 0;
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
}
