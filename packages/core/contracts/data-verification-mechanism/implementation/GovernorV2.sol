// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/MultiCaller.sol";
import "../../common/implementation/MultiRole.sol";
import "../interfaces/FinderInterface.sol";
import "../interfaces/IdentifierWhitelistInterface.sol";
import "../interfaces/OracleGovernanceInterface.sol";
import "./Constants.sol";
import "./AdminIdentifierLib.sol";

import "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title Takes proposals for certain governance actions and allows UMA token holders to vote on them.
 */
contract GovernorV2 is MultiRole, Lockable, MultiCaller {
    using Address for address;

    /****************************************
     *             GOVERNOR STATE           *
     ****************************************/

    // Permissioned governor rolls.
    enum Roles {
        Owner, // Can set the proposer.
        Proposer, // Address that can make proposals.
        EmergencyProposer // Address that can make emergency proposals.
    }

    // Structure to represent a transaction.
    struct Transaction {
        address to; // Target.
        uint256 value; // value, in eth, to be sent as the msg.value.
        bytes data; // payload data to be sent to the target. Would include encoded function call data usually.
    }

    // Structure to represent a governance proposal.
    struct Proposal {
        Transaction[] transactions; // Set of transactions to be sent, if the proposal is executed.
        uint256 requestTime; // Time at which the proposal was proposed.
        bytes ancillaryData; // Extra data appended to a proposal to enhance the voters information.
    }

    // Reference to UMA finder, used to find addresses of other UMA ecosystem contracts.
    FinderInterface public immutable finder;

    // Array of all proposals.
    Proposal[] public proposals;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event NewProposal(uint256 indexed id, Transaction[] transactions);

    event ProposalExecuted(uint256 indexed id, uint256 transactionIndex);
    event EmergencyExecution(address indexed to, uint256 value, bytes data);

    /**
     * @notice Construct the Governor contract.
     * @param _finderAddress keeps track of all contracts within the system based on their interfaceName.
     * @param _startingId the initial proposal id that the contract will begin incrementing from.
     */
    constructor(address _finderAddress, uint256 _startingId) {
        finder = FinderInterface(_finderAddress);
        _createExclusiveRole(uint256(Roles.Owner), uint256(Roles.Owner), msg.sender);
        _createExclusiveRole(uint256(Roles.Proposer), uint256(Roles.Owner), msg.sender);
        _createExclusiveRole(uint256(Roles.EmergencyProposer), uint256(Roles.Owner), msg.sender);

        // Ensure the startingId is not set unreasonably high to avoid it being set such that new proposals overwrite
        // other storage slots in the contract.
        uint256 maxStartingId = 10**18;
        require(_startingId <= maxStartingId, "Cannot set startingId larger than 10^18");

        // Sets the initial length of the array to the startingId. Modifying length directly has been disallowed in solidity 0.6.
        assembly {
            sstore(proposals.slot, _startingId)
        }
    }

    /****************************************
     *          PROPOSAL ACTIONS            *
     ****************************************/

    /**
     * @notice Proposes a new governance action. Can only be called by the holder of the Proposer role.
     * @param transactions list of transactions that are being proposed.
     * @param ancillaryData arbitrary data appended to a price request to give the voters more info from the caller.
     */
    function propose(Transaction[] memory transactions, bytes memory ancillaryData)
        external
        nonReentrant()
        onlyRoleHolder(uint256(Roles.Proposer))
    {
        require(transactions.length > 0, "Empty transactions array");
        uint256 id = proposals.length;
        uint256 time = getCurrentTime();

        // Note: doing all of this array manipulation manually is necessary because directly setting an array of
        // structs in storage to an array of structs in memory is currently not implemented in solidity :/.

        // Add a zero-initialized element to the proposals array.
        proposals.push();

        // Initialize the new proposal.
        Proposal storage proposal = proposals[id];
        proposal.requestTime = time;
        proposal.ancillaryData = ancillaryData;

        // Initialize the transaction array.
        for (uint256 i = 0; i < transactions.length; i++) {
            require(transactions[i].to != address(0), "The `to` address cannot be 0x0");
            // If the transaction has any data with it the recipient must be a contract, not an EOA.
            if (transactions[i].data.length > 0) {
                require(transactions[i].to.isContract(), "EOA can't accept tx with data");
            }
            proposal.transactions.push(transactions[i]);
        }

        bytes32 identifier = AdminIdentifierLib._constructIdentifier(id);

        // Request a vote on this proposal in the DVM.
        _getOracle().requestGovernanceAction(identifier, time, ancillaryData);

        emit NewProposal(id, transactions);
    }

    /**
     * @notice Executes a proposed governance action that has been approved by voters.
     * @dev This can be called by any address. Caller is expected to send enough ETH to execute payable transactions.
     * @param id unique id for the executed proposal.
     * @param transactionIndex unique transaction index for the executed proposal.
     */
    function executeProposal(uint256 id, uint256 transactionIndex) external payable nonReentrant() {
        Proposal storage proposal = proposals[id];
        int256 price =
            _getOracle().getPrice(
                AdminIdentifierLib._constructIdentifier(id),
                proposal.requestTime,
                proposal.ancillaryData
            );

        Transaction memory transaction = proposal.transactions[transactionIndex];

        require(
            transactionIndex == 0 || proposal.transactions[transactionIndex - 1].to == address(0),
            "Previous tx not yet executed"
        );
        require(transaction.to != address(0), "Tx already executed");
        require(price != 0, "Proposal was rejected");
        require(msg.value == transaction.value, "Must send exact amount of ETH");

        // Delete the transaction before execution to avoid any potential re-entrancy issues.
        delete proposal.transactions[transactionIndex];

        require(_executeCall(transaction.to, transaction.value, transaction.data), "Tx execution failed");

        emit ProposalExecuted(id, transactionIndex);
    }

    /**
     * @notice Emergency execution method that bypasses the voting system to execute a transaction.
     * @dev This can only be called by the EmergencyProposer.
     * @param transaction a single transaction to execute.
     */
    function emergencyExecute(Transaction memory transaction)
        external
        payable
        nonReentrant()
        onlyRoleHolder(uint256(Roles.EmergencyProposer))
    {
        require(_executeCall(transaction.to, transaction.value, transaction.data), "Tx execution failed");

        emit EmergencyExecution(transaction.to, transaction.value, transaction.data);
    }

    /**
     * @notice Returns the current block timestamp.
     * @dev Can be overridden to control contract time.
     * @return the current block timestamp.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    /****************************************
     *       GOVERNOR STATE GETTERS         *
     ****************************************/

    /**
     * @notice Gets the total number of proposals (includes executed and non-executed).
     * @return uint256 representing the current number of proposals.
     */
    function numProposals() external view returns (uint256) {
        return proposals.length;
    }

    /**
     * @notice Gets the proposal data for a particular id.
     * @dev after a proposal is executed, its data will be zeroed out, except for the request time and ancillary data.
     * @param id uniquely identify the identity of the proposal.
     * @return proposal struct containing transactions[] and requestTime.
     */
    function getProposal(uint256 id) external view returns (Proposal memory) {
        return proposals[id];
    }

    /****************************************
     *      PRIVATE GETTERS AND FUNCTIONS   *
     ****************************************/

    // Runs a function call on to, with value eth sent and data payload.
    function _executeCall(
        address to,
        uint256 value,
        bytes memory data
    ) private returns (bool) {
        // Mostly copied from:
        // solhint-disable-next-line max-line-length
        // https://github.com/gnosis/safe-contracts/blob/59cfdaebcd8b87a0a32f87b50fead092c10d3a05/contracts/base/Executor.sol#L23-L31
        // solhint-disable-next-line no-inline-assembly

        bool success;
        assembly {
            let inputData := add(data, 0x20)
            let inputDataSize := mload(data)
            success := call(gas(), to, value, inputData, inputDataSize, 0, 0)
        }
        return success;
    }

    // Returns the Voting contract address, named "Oracle" in the finder.
    function _getOracle() private view returns (OracleGovernanceInterface) {
        return OracleGovernanceInterface(finder.getImplementationAddress(OracleInterfaces.Oracle));
    }

    // Returns the IdentifierWhitelist contract address, named "IdentifierWhitelist" in the finder.
    function _getIdentifierWhitelist() private view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }
}
