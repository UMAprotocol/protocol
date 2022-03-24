// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.6;

import "@gnosis.pm/zodiac/contracts/core/Module.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../oracle/implementation/Constants.sol";
import "../oracle/interfaces/FinderInterface.sol";
import "../oracle/interfaces/SkinnyOptimisticOracleInterface.sol";
import "../oracle/interfaces/OracleAncillaryInterface.sol";
import "../common/implementation/Lockable.sol";
import "../common/interfaces/AddressWhitelistInterface.sol";
import "../common/implementation/AncillaryData.sol";
import "../oracle/interfaces/StoreInterface.sol";

contract OptimisticOracleModule is Module, Lockable {
    using SafeERC20 for IERC20;

    event OptimisticOracleModuleDeployed(address indexed owner, address indexed avatar, address target);

    event TransactionsProposed(
        uint256 indexed proposalId,
        address indexed proposer,
        uint256 indexed proposalTime,
        Proposal proposal
    );

    event TransactionExecuted(uint256 indexed proposalId, uint256 indexed transactionIndex);

    event ProposalDeleted(uint256 indexed proposalId);

    // Since finder is set during setUp, you will need to deploy a new Optimistic Oracle module if this address need to be changed in the future.
    FinderInterface public finder;

    IERC20 public collateral;
    uint64 public liveness;
    uint256 public finalFee;
    // Extra bond in addition to the final fee for the collateral type.
    uint256 public bond;
    string public rules;
    // This will usually be "ZODIAC" but a deployer may want to create a more specific identifier.
    bytes32 public identifier;
    SkinnyOptimisticOracleInterface public skinnyOptimisticOracle;
    StoreInterface public store;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        Enum.Operation operation;
    }

    struct Proposal {
        Transaction[] transactions;
        uint256 requestTime;
        bytes ancillaryData;
        bool status;
    }

    mapping(uint256 => bytes32) proposalHashes;
    uint256 prevProposalId;

    // Proposal[] public proposals;

    /**
     * @notice Construct Optimistic Oracle Module.
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
        finder = FinderInterface(_finder);
        require(_getCollateralWhitelist().isOnWhitelist(address(_collateral)), "bond token not supported");
        collateral = IERC20(_collateral);
        bond = _bond;
        rules = _rules;
        identifier = _identifier;
        require(_liveness > 0, "liveness can't be 0");
        liveness = _liveness;
        setAvatar(_owner);
        setTarget(_owner);
        transferOwnership(_owner);
        _sync();

        emit OptimisticOracleModuleDeployed(_owner, avatar, target);
    }

    function setBond(uint256 _bond) public onlyOwner {
        // Value of the bond required for proposals, in addition to the final fee.
        bond = _bond;
    }

    function setCollateral(IERC20 _collateral) public onlyOwner nonReentrant {
        // ERC20 token to be used as collateral (must be approved by UMA Store contract).
        require(_getCollateralWhitelist().isOnWhitelist(address(_collateral)), "bond token not supported");
        collateral = _collateral;
    }

    function setRules(string memory _rules) public onlyOwner {
        // Set reference to the rules for the avatar (e.g. an IPFS hash or URI).
        rules = _rules;
    }

    function setLiveness(uint64 _liveness) public onlyOwner {
        // Set liveness for disputing proposed transactions.
        require(_liveness > 0, "liveness can't be 0");
        liveness = _liveness;
    }

    function setIdentifier(bytes32 _identifier) public onlyOwner {
        // Set identifier which is used along with the rules to determine if transactions are valid.
        identifier = _identifier;
    }

    function sync() public nonReentrant {
        // Sync the store and oracle contract addresses as well as the final fee.
        _sync();
    }

    function proposeTransactions(Transaction[] memory _transactions, bytes memory _explanation) public nonReentrant {
        // note: Optional explanation explains the intent of the transactions to make comprehension easier.
        uint256 id = prevProposalId + 1;
        uint256 time = getCurrentTime();
        address proposer = msg.sender;

        // Create proposal in memory to emit in an event.
        Proposal memory proposal;
        proposal.requestTime = time;

        // Construct the ancillary data.
        bytes memory ancillaryData = _explanation;
        AncillaryData.appendKeyValueUint(ancillaryData, "id", id);
        AncillaryData.appendKeyValueAddress(ancillaryData, "module", address(this));
        proposal.ancillaryData = ancillaryData;

        // Add transactions to proposal in memory.
        for (uint256 i = 0; i < _transactions.length; i++) {
            require(_transactions[i].to != address(0), "The `to` address cannot be 0x0");
            // If the transaction has any data with it the recipient must be a contract, not an EOA.
            if (_transactions[i].data.length > 0) {
                require(_isContract(_transactions[i].to), "EOA can't accept tx with data");
            }
            proposal.transactions[i] = _transactions[i];
        }

        // Add transaction data to the proposal data to be hashed and stored in the contract.
        bytes memory proposalData = abi.encodePacked(ancillaryData);

        for (uint256 i = 0; i < _transactions.length; i++) {
            proposalData = bytes.concat(abi.encodePacked(_transactions[i].to));
            proposalData = bytes.concat(abi.encodePacked(_transactions[i].value));
            proposalData = bytes.concat(abi.encodePacked(_transactions[i].data));
            proposalData = bytes.concat(abi.encodePacked(_transactions[i].operation));
        }

        proposalHashes[id] = keccak256(abi.encodePacked(proposalData));

        // Get the bond from the proposer and approve the bond and final fee to be used by the oracle.
        uint256 totalBond = finalFee + bond;
        collateral.safeTransferFrom(msg.sender, address(this), totalBond);
        collateral.safeIncreaseAllowance(address(skinnyOptimisticOracle), totalBond);

        // Propose a set of transactions to the OO. If not disputed, they can be executed with executeProposal().
        // docs: https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/oracle/interfaces/SkinnyOptimisticOracleInterface.sol
        skinnyOptimisticOracle.requestAndProposePriceFor(
            identifier,
            uint32(time),
            ancillaryData,
            collateral,
            0,
            bond,
            uint256(liveness),
            proposer,
            // Canonical value representing "True"; i.e. the transactions are valid.
            int256(1e18)
        );

        emit TransactionsProposed(id, proposer, time, proposal);
    }

    function executeProposal(
        uint256 _proposalId,
        Transaction[] memory _transactions,
        bytes memory _ancillaryData,
        uint256 _originalTime
    ) public payable nonReentrant {
        // This will revert if the price has not settled.
        int256 price = _getOracle().getPrice(identifier, _originalTime, _ancillaryData);
        require(price == 1e18, "Proposal was rejected");

        for (uint256 i = 0; i < _transactions.length; i++) {
            require(i == 0 || _transactions[i - 1].to == address(0), "Previous tx not yet executed");
            Transaction memory transaction = _transactions[i];
            require(transaction.to != address(0), "Tx already executed");
            require(msg.value == transaction.value, "Must send exact amount of ETH");

            // Delete the transaction before execution to avoid any potential re-entrancy issues.
            delete _transactions[i];

            require(
                exec(transaction.to, transaction.value, transaction.data, transaction.operation),
                "Failed to execute the transaction"
            );
            emit TransactionExecuted(_proposalId, i);
        }
    }

    function deleteProposal(uint256 _proposalId) public onlyOwner {
        // Delete a proposal that governance decided not to execute.
        delete proposalHashes[_proposalId];
        emit ProposalDeleted(_proposalId);
    }

    function deleteRejectedProposal(
        uint256 _proposalId,
        uint256 _originalTime,
        bytes memory _ancillaryData
    ) public {
        // This will revert if the price has not settled.
        int256 price = _getOracle().getPrice(identifier, _originalTime, _ancillaryData);

        // Check that proposal was rejected.
        require(price == 0, "Proposal was not rejected");

        // Delete the proposal.
        delete proposalHashes[_proposalId];
        emit ProposalDeleted(_proposalId);
    }

    // Can be overriden for testing.
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    function _getOptimisticOracle() private view returns (SkinnyOptimisticOracleInterface) {
        return
            SkinnyOptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.SkinnyOptimisticOracle));
    }

    function _getOracle() private view returns (OracleAncillaryInterface) {
        return OracleAncillaryInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    function _isContract(address addr) private view returns (bool isContract) {
        return addr.code.length > 0;
    }

    function _getCollateralWhitelist() internal view returns (AddressWhitelistInterface) {
        return AddressWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    function _sync() internal {
        store = _getStore();
        skinnyOptimisticOracle = _getOptimisticOracle();
        finalFee = store.computeFinalFee(address(collateral)).rawValue;
    }
}
