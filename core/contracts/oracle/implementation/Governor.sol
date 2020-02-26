pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "../../common/implementation/MultiRole.sol";
import "../../common/implementation/FixedPoint.sol";
import "../../common/implementation/Testable.sol";
import "../interfaces/FinderInterface.sol";
import "../interfaces/IdentifierWhitelistInterface.sol";
import "../interfaces/OracleInterface.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title Takes proposals for certain governance actions and allows UMA token holders to vote on them.
 */
contract Governor is MultiRole, Testable {
    using SafeMath for uint;

    /****************************************
     *     INTERNAL VARIABLES AND STORAGE   *
     ****************************************/

    enum Roles {
        Owner, // Can set the proposer.
        Proposer // Address that can make proposals.
    }

    struct Transaction {
        address to;
        uint value;
        bytes data;
    }

    struct Proposal {
        Transaction[] transactions;
        uint requestTime;
    }

    FinderInterface private finder;
    Proposal[] public proposals;

    /****************************************
     *                EVENTS                *
     ****************************************/

    // Emitted when a new proposal is created.
    event NewProposal(uint indexed id, Transaction[] transactions);

    // Emitted when an existing proposal is executed.
    event ProposalExecuted(uint indexed id, uint transactionIndex);

    /**
     * @notice Construct the Governor contract.
     * @param _finderAddress keeps track of all contracts within the system based on their interfaceName.
     * @param _isTest whether this contract is being constructed for the purpose of running automated tests.
     */
    constructor(address _finderAddress, bool _isTest) public Testable(_isTest) {
        finder = FinderInterface(_finderAddress);
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        _createExclusiveRole(uint(Roles.Proposer), uint(Roles.Owner), msg.sender);
    }

    /****************************************
     *          PROPOSAL ACTIONS            *
     ****************************************/

    /**
     * @notice Proposes a new governance action. Can only be called by the holder of the Proposer role.
     * @param transactions the list of transactions that are being proposed.
     * @dev You can create the data portion of each transaction by doing the following:
     * ```
     * const truffleContractInstance = await TruffleContract.deployed()
     * const data = truffleContractInstance.methods.methodToCall(arg1, arg2).encodeABI()
     * ```
     * Note: this method must be public because of a solidity limitation that
     * disallows structs arrays to be passed to external functions.
     * @param transactions array of `Transaction` which can be voted on.
     */
    function propose(Transaction[] memory transactions) public onlyRoleHolder(uint(Roles.Proposer)) {
        uint id = proposals.length;
        uint time = getCurrentTime();

        // Note: doing all of this array manipulation manually is necessary because directly setting an array of
        // structs in storage to an an array of structs in memory is currently not implemented in solidity :/.

        // Add an element to the proposals array.
        proposals.length = proposals.length.add(1);

        // Initialize the new proposal.
        Proposal storage proposal = proposals[id];
        proposal.requestTime = time;

        // Initialize the transaction array.
        proposal.transactions.length = transactions.length;
        for (uint i = 0; i < transactions.length; i++) {
            require(transactions[i].to != address(0), "The to address cannot be 0x0");
            proposal.transactions[i] = transactions[i];
        }

        bytes32 identifier = _constructIdentifier(id);

        // Request a vote on this proposal in the DVM.
        OracleInterface oracle = _getOracle();
        IdentifierWhitelistInterface supportedIdentifiers = _getIdentifierWhitelist();
        supportedIdentifiers.addSupportedIdentifier(identifier);

        oracle.requestPrice(identifier, time);
        supportedIdentifiers.removeSupportedIdentifier(identifier);

        emit NewProposal(id, transactions);
    }

    /**
     * @notice Executes a proposed governance action that has been approved by voters.
     * @dev This can be called by any address.
     * @param id unique id for the executed proposal.
     * @param transactionIndex unique transaction index for the executed proposal.
     */
    function executeProposal(uint id, uint transactionIndex) external {
        Proposal storage proposal = proposals[id];
        int price = _getOracle().getPrice(_constructIdentifier(id), proposal.requestTime);

        Transaction storage transaction = proposal.transactions[transactionIndex];

        require(
            transactionIndex == 0 || proposal.transactions[transactionIndex.sub(1)].to == address(0),
            "Previous transaction has not been executed"
        );
        require(transaction.to != address(0), "Transaction has already been executed");
        require(price != 0, "Cannot execute, proposal was voted down");
        require(_executeCall(transaction.to, transaction.value, transaction.data), "Transaction execution failed");

        // Delete the transaction.
        delete proposal.transactions[transactionIndex];

        emit ProposalExecuted(id, transactionIndex);
    }

    /***************************************
    *          VOTING STATE GETTERS        *
    ****************************************/

    /**
     * @notice Gets the total number of proposals (includes executed and non-executed).
     * @return uint representing the current number of proposals.
     */
    function numProposals() external view returns (uint) {
        return proposals.length;
    }

    /**
     * @notice Gets the proposal data for a particular id.
     * @dev after a proposal is executed, its data will be zeroed out.
     * @param id to uniquely identify the identity of the proposal.
     * @return proposal struct containing transactions[] and requestTime.
     */
    function getProposal(uint id) external view returns (Proposal memory proposal) {
        return proposals[id];
    }

    /****************************************
     *      PRIVATE GETTERS AND FUNCTIONS   *
     ****************************************/

    function _executeCall(address to, uint256 value, bytes memory data) private returns (bool success) {
        // Mostly copied from:
        // solhint-disable-next-line max-line-length
        // https://github.com/gnosis/safe-contracts/blob/59cfdaebcd8b87a0a32f87b50fead092c10d3a05/contracts/base/Executor.sol#L23-L31
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let inputData := add(data, 0x20)
            let inputDataSize := mload(data)
            success := call(gas, to, value, inputData, inputDataSize, 0, 0)
        }
    }

    function _getOracle() private view returns (OracleInterface oracle) {
        return OracleInterface(finder.getImplementationAddress("Oracle"));
    }

    function _getIdentifierWhitelist() private view returns (IdentifierWhitelistInterface supportedIdentifiers) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress("IdentifierWhitelist"));
    }

    function _constructIdentifier(uint id) private pure returns (bytes32 identifier) {
        bytes32 bytesId = _uintToBytes(id);
        return _addPrefix(bytesId, "Admin ", 6);
    }

    // This method is based off of this code: https://ethereum.stackexchange.com/a/6613/47801.
    function _uintToBytes(uint v) private pure returns (bytes32 ret) {
        if (v == 0) {
            ret = "0";
        } else {
            while (v > 0) {
                ret = ret >> 8;
                ret |= bytes32((v % 10) + 48) << (31 * 8);
                v /= 10;
            }
        }
        return ret;
    }

    function _addPrefix(bytes32 input, bytes32 prefix, uint prefixLength) private pure returns (bytes32 output) {
        bytes32 shiftedInput = input >> (prefixLength * 8);
        return shiftedInput | prefix;
    }
}
