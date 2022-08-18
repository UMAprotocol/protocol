// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "./Finder.sol";
import "./GovernorV2.sol";
import "./Constants.sol";
import "../interfaces/OracleAncillaryInterface.sol";
import "./AdminIdentifierLib.sol";
import "../../common/implementation/Lockable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Emergency Proposer contract that allows anyone to construct an emergency recovery transaction to bypass the
 * standard voting process. If a proposal is considered invalid, UMA token holders can vote to remove this proposal
 * through the standard governance flow. If valid, a proposal must wait minimumWaitTime before it can be executed and
 * it can only be executed by a privileged account, executor.
 */
contract EmergencyProposer is Ownable, Lockable {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    uint256 public quorum;
    uint256 public minimumWaitTime = 1 weeks;

    GovernorV2 public immutable governor;
    Finder public immutable finder;

    struct EmergencyProposal {
        address sender;
        // 64 bits to save a storage slot.
        uint64 expiryTime;
        uint256 lockedTokens;
        GovernorV2.Transaction[] transactions;
    }
    mapping(uint256 => EmergencyProposal) public emergencyProposals;
    uint256 public currentId;
    address public executor;

    event QuorumSet(uint256 quorum);
    event ExecutorSet(address executor);
    event minimumWaitTimeSet(address executor);
    event EmergencyTransactionsProposed(uint256 indexed id, GovernorV2.Transaction[] transactions);
    event EmergencyTransactionsRemoved(uint256 indexed id, GovernorV2.Transaction[] transactions);
    event EmergencyTransactionsSlashed(uint256 indexed id, GovernorV2.Transaction[] transactions);
    event EmergencyTransactionsExecuted(uint256 indexed id, GovernorV2.Transaction[] transactions);

    /**
     * @notice Construct the EmergencyProposer contract.
     * @param _token the ERC20 token that the quorum is in.
     * @param _quorum the tokens needed to propose.
     * @param _governor the governor contract that this contract makes proposals to.
     * @param _finder the finder contract used to look up addresses.
     */
    constructor(
        IERC20 _token,
        uint256 _quorum,
        GovernorV2 _governor,
        Finder _finder,
        address _executor
    ) {
        token = _token;
        governor = _governor;
        finder = _finder;
        setExecutor(_executor);
        setQuorum(_quorum);
        transferOwnership(address(_governor));
    }

    /**
     * @notice Propose an emergency admin action to execute on the DVM as a set of proposed transactions.
     * @dev Caller of this method must approve (and have) quorum amount of token to be pulled from their wallet.
     * @param transactions array of transactions to be executed in the emergency action. When executed, will be sent
     * via the governor contract.
     */
    function emergencyPropose(GovernorV2.Transaction[] memory transactions) external nonReentrant() returns (uint256) {
        token.safeTransferFrom(msg.sender, address(this), quorum);
        uint256 id = currentId++;
        emergencyProposals[id] = EmergencyProposal({
            sender: msg.sender,
            lockedTokens: quorum,
            expiryTime: uint64(getCurrentTime()) + minimumWaitTime,
            transactions: transactions
        });

        emit EmergencyTransactionsProposed(id, transactions);
        return id;
    }

    function removeProposal(uint256 id) external nonReentrant() {
        EmergencyProposal storage proposal = emergencyProposals[id];
        require(proposal.expiryTime < getCurrentTime(), "must be expired to remove");
        require(msg.sender == proposal.sender || msg.sender == executor, "proposer or executor");
        require(proposal.lockedTokens != 0, "invalid proposal");
        token.safeTransfer(proposal.sender, proposal.lockedTokens);
        delete emergencyProposals[id];
    }

    function slashProposal(uint256 id) external nonReentrant() onlyOwner() {
        EmergencyProposal storage proposal = emergencyProposals[id];
        require(proposal.lockedTokens != 0, "invalid proposal");
        token.safeTransfer(address(governor), proposal.lockedTokens);
        delete emergencyProposals[id];
    }

    function executeEmergencyProposal(uint256 id) public payable {
        require(msg.sender == executor, "must be called by executor");

        EmergencyProposal storage proposal = emergencyProposals[id];
        require(proposal.lockedTokens != 0, "invalid proposal");
        require(proposal.expiryTime < getCurrentTime(), "invalid proposal");

        for (uint256 i = 0; i < proposal.transactions.length; i++) {
            governor.emergencyExecute{ value: address(this).balance }(proposal.transactions[i]);
        }

        token.safeTransfer(proposal.sender, proposal.lockedTokens);
        delete emergencyProposals[id];
    }

    /**
     * @notice Admin method to set the quorum size.
     * @dev Admin is intended to be the governance system itself.
     * @param _quorum the new quorum.
     */
    function setQuorum(uint256 _quorum) public nonReentrant() onlyOwner() {
        quorum = _quorum;
        emit QuorumSet(_quorum);
    }

    function setExecutor(address _executor) public nonReentrant() onlyOwner() {
        executor = _executor;
        emit ExecutorSet(_executor);
    }

    function setMinimumWaitTime(address newMinimumWaitTime) public nonReentrant() onlyOwner() {
        minimumWaitTime = newMinimumWaitTime;
        emit minimumWaitTimeSet(_executor);
    }

    /**
     * @notice Returns the current block timestamp.
     * @dev Can be overridden to control contract time.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }
}
