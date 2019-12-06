pragma solidity ^0.5.0;

import "./Finder.sol";
import "./MultiRole.sol";
import "./FixedPoint.sol";
import "./Voting.sol";
import "./Testable.sol";


/**
 * @title Takes proposals for certain governance actions and allows UMA token holders to vote on them.
 */
contract Governor is MultiRole, Testable {

    enum Roles {
        // Can set the proposer.
        Admin,
        // Address that can make proposals.
        Proposer
    }

    struct Proposal {
        address to;
        uint value;
        bytes data;
        uint requestTime;
    }

    Finder internal finder;
    Proposal[] public proposals;

    /**
     * @notice Emitted when a new proposal is created.
     */
    event NewProposal(uint indexed id, address indexed to, uint value, bytes data);

    /**
     * @notice Emitted when an existing proposal is executed.
     */
    event ProposalExecuted(uint indexed id);

    constructor(address _finderAddress, bool _isTest) public Testable(_isTest) {
        finder = Finder(_finderAddress);
        _createExclusiveRole(uint(Roles.Admin), uint(Roles.Admin), msg.sender);
        _createExclusiveRole(uint(Roles.Proposer), uint(Roles.Admin), msg.sender);
    }

    /**
     * @notice Proposes a new governance action. Can only be called by the holder of the Proposer role.
     * @param to the address to call.
     * @param value the ETH value to attach to the call.
     * @param data the transaction data to attach to the call.
     * @dev You can create the data portion of the transaction by doing the following:
     * ```
     * const truffleContractInstance = await TruffleContract.deployed()
     * const data = truffleContractInstance.methods.methodToCall(arg1, arg2).encodeABI()
     * ```
     */
    function propose(address to, uint value, bytes calldata data) external onlyRoleHolder(uint(Roles.Proposer)) {
        require(to != address(0), "The to address cannot be 0x0");

        uint id = proposals.length;
        uint time = getCurrentTime();

        proposals.push(Proposal({
            to: to,
            value: value,
            data: data,
            requestTime: time
        }));

        bytes32 identifier = _constructIdentifier(id);

        // Request a vote on this proposal in the DVM.
        Voting voting = _getVoting();
        voting.addSupportedIdentifier(identifier);

        // Note: this check is only here to appease slither.
        require(voting.requestPrice(identifier, time) != ~uint(0);, "Proposal will never be considered");
        voting.removeSupportedIdentifier(identifier);

        emit NewProposal(id, to, value, data);
    }

    /**
     * @notice Executes a proposed governance action that has been approved by voters. This can be called by anyone.
     */
    function executeProposal(uint id) external {
        Proposal storage proposal = proposals[id];
        int price = _getVoting().getPrice(_constructIdentifier(id), proposal.requestTime);

        require(proposal.to != address(0), "Proposal has already been executed");
        require(price != 0, "Cannot execute, proposal was voted down");
        require(_executeCall(proposal.to, proposal.value, proposal.data), "Proposal execution failed");

        // Delete the proposal.
        delete proposals[id];

        emit ProposalExecuted(id);
    }

    function numProposals() external view returns (uint) {
        return proposals.length;
    }

    function _constructIdentifier(uint id) private pure returns (bytes32 identifier) {
        bytes32 bytesId = _uintToBytes(id);
        return _addPrefix(bytesId, "Admin ", 6);
    }

    function _executeCall(address to, uint256 value, bytes memory data)
        private
        returns (bool success)
    {
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

    function _getVoting() private view returns (Voting voting) {
        return Voting(finder.getImplementationAddress("Oracle"));
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
