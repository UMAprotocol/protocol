// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.6;

import "@gnosis.pm/zodiac/contracts/core/Module.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../oracle/implementation/Constants.sol";
import "../oracle/interfaces/FinderInterface.sol";
import "../oracle/interfaces/SkinnyOptimisticOracleInterface.sol";
import "../oracle/interfaces/OracleAncillaryInterface.sol";
import "../common/implementation/Lockable.sol";

contract OptimisticOracleModule is Module {
    event OptimisticOracleModuleDeployed(address indexed owner, address indexed avatar, address target);

    event TransactionsProposed(uint256 indexed proposalId, address indexed proposer, uint256 indexed proposalTime);

    event TransactionExecuted(uint256 indexed proposalId, uint256 indexed transactionIndex);

    event ProposalDeleted(uint256 indexed proposalId);

    FinderInterface public finder;
    SkinnyOptimisticOracleInterface public optimisticOracle;

    IERC20 public collateral;
    uint64 public liveness;
    // extra bond in addition to the final fee for the collateral type
    uint256 public bond;
    string public rules;
    bytes32 public immutable identifier = "ZODIAC";

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

    Proposal[] public proposals;

    /**
     * @notice Construct Optimistic Oracle Module.
     * @param _finder Finder address.
     * @param _owner Address of the owner.
     * @param _collateral Address of the ERC20 collateral used for bonds.
     * @param _bond Bond required (must be at least as large as final fee for collateral type).
     * @param _rules Reference to the rules for the Gnosis Safe (e.g., IPFS hash or URI).
     */
    constructor(
        address _finder,
        address _owner,
        address _collateral,
        uint256 _bond,
        string memory _rules
    ) {
        bytes memory initializeParams = abi.encode(_finder, _owner, _collateral, _bond, _rules);
        setUp(initializeParams);
    }

    function setUp(bytes memory initializeParams) public override initializer {
        __Ownable_init();
        (address _finder, address _owner, address _collateral, uint256 _bond, string memory _rules) =
            abi.decode(initializeParams, (address, address, address, uint256, string));
        finder = FinderInterface(_finder);
        optimisticOracle = _getOptimisticOracle();
        // check collateral is whitelisted
        collateral = IERC20(_collateral);
        // check bond amount is large enough
        bond = _bond;
        rules = _rules;
        setAvatar(_owner);
        setTarget(_owner);
        transferOwnership(_owner);

        emit OptimisticOracleModuleDeployed(_owner, avatar, target);
    }

    function setBond(uint256 _bond) public onlyOwner {
        // value of the bond required for proposals (must be greater than optimistic oracle final fee)
        bond = _bond;
    }

    function setCollateral(IERC20 _collateral) public onlyOwner {
        // ERC20 token to be used as collateral (must be approved by UMA Store contract).
        collateral = _collateral;
    }

    function setRules(string memory _rules) public onlyOwner {
        // set reference to the rules for the avatar (e.g. an IPFS hash or URI)
        rules = _rules;
    }

    function setLiveness(uint256 _liveness) public onlyOwner {
        // set liveness for disputing proposed transactions
        liveness = _liveness;
    }

    function proposeTransactions(Transaction[] memory _transactions, bytes memory _ancillaryData)
        public
        nonReentrant()
    {
        // create a proposal with a bundle of transactions
        // note: based in part on the UMA Governor contract
        // https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/oracle/implementation/Governor.sol
        // note: optional ancillaryData explains the intent of the transactions to make comprehension easier
        uint256 id = proposals.length;
        uint256 time = block.timestamp;
        address proposer = msg.sender;

        // Add a zero-initialized element to the proposals array.
        Proposal storage proposal = proposals.push();
        proposal.requestTime = time;
        proposal.ancillaryData = _ancillaryData;

        // Initialize the transaction array.
        for (uint256 i = 0; i < _transactions.length; i++) {
            require(_transactions[i].to != address(0), "The `to` address cannot be 0x0");
            // If the transaction has any data with it the recipient must be a contract, not an EOA.
            if (_transactions[i].data.length > 0) {
                require(_isContract(_transactions[i].to), "EOA can't accept tx with data");
            }
            proposal.transactions.push(_transactions[i]);
        }

        // Propose a set of transactions to the OO. If not disputed, they can be executed with executeProposal().
        // docs: https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/oracle/interfaces/SkinnyOptimisticOracleInterface.sol
        optimisticOracle.requestAndProposePriceFor(
            identifier,
            uint32(time),
            proposal.ancillaryData,
            collateral,
            0,
            bond,
            liveness,
            proposer,
            // Canonical value representing "True"; i.e. the transactions are valid.
            int256(1e18)
        );

        emit TransactionsProposed(id, proposer, time);
    }

    function executeProposal(uint256 _proposalId, uint256 _transactionIndex) public payable nonReentrant() {
        // execute transactions in an approved proposal using exec() function
        Proposal storage proposal = proposals[_proposalId];

        // this will revert if the price has not settled
        int256 price = _getOracle().getPrice(identifier, proposal.requestTime, proposal.ancillaryData);

        Transaction memory transaction = proposal.transactions[_transactionIndex];

        require(
            _transactionIndex == 0 || proposal.transactions[_transactionIndex - 1].to == address(0),
            "Previous tx not yet executed"
        );
        require(transaction.to != address(0), "Tx already executed");
        require(price != 0, "Proposal was rejected");
        require(msg.value == transaction.value, "Must send exact amount of ETH");

        // Delete the transaction before execution to avoid any potential re-entrancy issues.
        delete proposal.transactions[_transactionIndex];

        require(
            exec(transaction.to, transaction.value, transaction.data, transaction.operation),
            "Failed to execute the transaction"
        );
        emit TransactionExecuted(_proposalId, _transactionIndex);
    }

    function deleteProposal(uint256 _proposalId) public onlyOwner {
        // delete a proposal that governance decided not to execute
        delete proposals[_proposalId];
        emit ProposalDeleted(_proposalId);
    }

    function deleteRejectedProposal(uint256 _proposalId) public {
        // execute transactions in an approved proposal using exec() function
        Proposal storage proposal = proposals[_proposalId];

        // this will revert if the price has not settled
        int256 price = _getOracle().getPrice(identifier, proposal.requestTime, proposal.ancillaryData);

        // check that proposal was rejected
        require(price == 0, "Proposal was not rejected");

        // Delete the proposal
        delete proposals[_proposalId];
        emit ProposalDeleted(_proposalId);
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
}
