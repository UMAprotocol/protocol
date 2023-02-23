// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "./GovernorV2.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/MultiCaller.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Emergency Proposer contract
 * @dev This is a contract that allows anyone to construct an emergency recovery transaction to bypass the
 * standard voting process by submitting a very large bond, which is considered a quorum in this case. This bond is
 * expected to be about as large as the GAT in the VotingV2 contract. If a proposal is considered invalid, UMA token
 * holders can vote to slash and remove this proposal through the standard governance flow. If valid, a proposal must
 * wait minimumWaitTime before it can be executed and it can only be executed by a privileged account, executor. This
 * includes three tiers of protection to ensure that abuse is extremely risky both from creating market volatility in
 * the underlying token and the threat of the locked tokens being slashed.
 */
contract EmergencyProposer is Ownable, Lockable, MultiCaller {
    using SafeERC20 for IERC20;

    /****************************************
     *      EMERGENCY PROPOSAL STATE        *
     ****************************************/

    // Identifies a unique emergency proposal.
    struct EmergencyProposal {
        address sender; // Sender of the proposal. Address that receives the bond refund in the case of execution.
        uint64 expiryTime; // Time at which the proposal expires and can be executed.
        uint256 lockedTokens; // Tokens locked for the proposal. Tokens are returned when proposal is executed.
        GovernorV2.Transaction[] transactions; // Array of transactions to be executed in the emergency action.
    }

    // Array of all proposed emergency proposals.
    EmergencyProposal[] public emergencyProposals;

    // UMA Governor, used to execute transactions. The Governor is the owner of all other UMA ecosystem contracts.
    GovernorV2 public immutable governor;

    // Voting token, used to bond proposes.
    IERC20 public immutable token;

    // The number of tokens needed to propose an emergency action.
    uint256 public quorum;

    // The minimum time that must elapse between from when a proposal is created to when it can be executed.
    uint64 public minimumWaitTime;

    // The only address that can execute an emergency proposal. Will be set to a multisig. Acts to guardrail the
    // emergency recovery mechanism and ensure that only valid proposals can be executed. Note that while this address
    // is somewhat privileged, it can't unilaterally push through proposals as a proposal must pass the minimum wait
    // time without the DVM voters voting to slash the proposal.
    address public executor;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event QuorumSet(uint256 quorum);
    event ExecutorSet(address executor);
    event MinimumWaitTimeSet(uint256 minimumWaitTime);
    event EmergencyTransactionsProposed(
        uint256 indexed id,
        address indexed sender,
        address indexed caller,
        uint64 expiryTime,
        uint256 lockedTokens,
        GovernorV2.Transaction[] transactions
    );
    event EmergencyProposalRemoved(
        uint256 indexed id,
        address indexed sender,
        address indexed caller,
        uint64 expiryTime,
        uint256 lockedTokens,
        GovernorV2.Transaction[] transactions
    );
    event EmergencyProposalSlashed(
        uint256 indexed id,
        address indexed sender,
        address indexed caller,
        uint64 expiryTime,
        uint256 lockedTokens,
        GovernorV2.Transaction[] transactions
    );
    event EmergencyProposalExecuted(
        uint256 indexed id,
        address indexed sender,
        address indexed caller,
        uint64 expiryTime,
        uint256 lockedTokens,
        GovernorV2.Transaction[] transactions
    );

    /**
     * @notice Construct the EmergencyProposer contract.
     * @param _token the ERC20 token that the quorum is in.
     * @param _quorum the tokens needed to propose an emergency action.
     * @param _governor the governor contract that this contract makes proposals to.
     * @param _executor the address that can execute an emergency proposal.
     * @param _minimumWaitTime the minimum time that must elapse between from when a proposal is created to when it can
     * be executed.
     */
    constructor(
        IERC20 _token,
        uint256 _quorum,
        GovernorV2 _governor,
        address _executor,
        uint64 _minimumWaitTime
    ) {
        token = _token;
        governor = _governor;
        setExecutor(_executor);
        setQuorum(_quorum);

        setMinimumWaitTime(_minimumWaitTime);
        transferOwnership(address(_governor));
    }

    /**
     * @notice Propose an emergency admin action to execute on the DVM as a set of proposed transactions.
     * @dev Caller of this method must approve (and have) quorum amount of token to be pulled from their wallet.
     * @param transactions array of transactions to be executed in the emergency action. When executed, will be sent
     * via the governor contract.
     * @return uint256 the emergency proposal id.
     */
    function emergencyPropose(GovernorV2.Transaction[] memory transactions) external nonReentrant() returns (uint256) {
        require(msg.sender != address(governor), "Governor can't propose"); // The governor should never be the proposer.
        require(transactions.length > 0, "No transactions to propose");
        token.safeTransferFrom(msg.sender, address(this), quorum);
        uint256 id = emergencyProposals.length;
        EmergencyProposal storage proposal = emergencyProposals.push();
        proposal.sender = msg.sender;
        proposal.lockedTokens = quorum;
        proposal.expiryTime = uint64(getCurrentTime()) + minimumWaitTime;

        for (uint256 i = 0; i < transactions.length; i++) proposal.transactions.push(transactions[i]);

        emit EmergencyTransactionsProposed(id, msg.sender, msg.sender, proposal.expiryTime, quorum, transactions);
        return id;
    }

    /**
     * @notice After the proposal is executable, the executor or owner can use this function to remove the proposal
     * without slashing.
     * @dev This means that the DVM didn't explicitly reject the proposal. Allowing the executor to slash the quorum
     * would give the executor too much power. So the only control either party has is to remove the proposal,
     * releasing the bond. The proposal should not be removable before its liveness/expiry to ensure the regular Voting
     * system's slash cannot be frontrun.
     * @param id id of the proposal.
     */
    function removeProposal(uint256 id) external nonReentrant() {
        EmergencyProposal storage proposal = emergencyProposals[id];
        require(proposal.expiryTime <= getCurrentTime(), "must be expired to remove");
        require(msg.sender == owner() || msg.sender == executor, "owner or executor");
        require(proposal.lockedTokens != 0, "invalid proposal");
        token.safeTransfer(proposal.sender, proposal.lockedTokens);
        emit EmergencyProposalRemoved(
            id,
            proposal.sender,
            msg.sender,
            proposal.expiryTime,
            proposal.lockedTokens,
            proposal.transactions
        );
        delete emergencyProposals[id];
    }

    /**
     * @notice Before a proposal expires (or after), this method can be used by the owner, which should generally be
     * the GovernorV2 contract, to slash the proposer.
     * @dev The slash results in the proposer's tokens being sent to the Governor contract.
     * @param id id of the proposal.
     */
    function slashProposal(uint256 id) external nonReentrant() onlyOwner() {
        EmergencyProposal storage proposal = emergencyProposals[id];
        require(proposal.lockedTokens != 0, "invalid proposal");
        token.safeTransfer(address(governor), proposal.lockedTokens);
        emit EmergencyProposalSlashed(
            id,
            proposal.sender,
            msg.sender,
            proposal.expiryTime,
            proposal.lockedTokens,
            proposal.transactions
        );
        delete emergencyProposals[id];
    }

    /**
     * @notice After a proposal expires, this method can be used by the executor to execute the proposal.
     * @dev This method effectively gives the executor veto power over any proposal.
     * @dev The first transaction execution sends the total amount of ETH required to complete all payable
     * transactions in the Governor. The EmergencyProposer must receive this amount of ETH in advance.
     * The executed transactions are then able to use this ETH by including a nonzero value.
     * @param id id of the proposal.
     */
    function executeEmergencyProposal(uint256 id) external payable nonReentrant() {
        require(msg.sender == executor, "must be called by executor");

        EmergencyProposal storage proposal = emergencyProposals[id];
        require(proposal.lockedTokens != 0, "invalid proposal");
        require(proposal.expiryTime <= getCurrentTime(), "must be expired to execute");

        for (uint256 i = 0; i < proposal.transactions.length; i++)
            governor.emergencyExecute{ value: address(this).balance }(proposal.transactions[i]);

        token.safeTransfer(proposal.sender, proposal.lockedTokens);
        emit EmergencyProposalExecuted(
            id,
            proposal.sender,
            msg.sender,
            proposal.expiryTime,
            proposal.lockedTokens,
            proposal.transactions
        );
        delete emergencyProposals[id];
    }

    /**
     * @notice Admin method to set the quorum (bond) size.
     * @dev Admin is intended to be the governance system.
     * @param newQuorum the new quorum.
     */
    function setQuorum(uint256 newQuorum) public nonReentrant() onlyOwner() {
        require(newQuorum != 0, "quorum must be > 0");
        require(newQuorum < token.totalSupply(), "quorum must be < totalSupply");
        quorum = newQuorum;
        emit QuorumSet(newQuorum);
    }

    /**
     * @notice Admin method to set the executor address.
     * @dev Admin is intended to be the governance system.
     * @param newExecutor the new executor address.
     */
    function setExecutor(address newExecutor) public nonReentrant() onlyOwner() {
        executor = newExecutor;
        emit ExecutorSet(newExecutor);
    }

    /**
     * @notice Admin method to set the minimum wait time for a proposal to be executed.
     * @dev Admin is intended to be the governance system. The minimum wait time is added to the current time at the
     * time of the proposal to determine when the proposal will be executable. Any changes to this value after that
     * point will have no impact on the proposal.
     * @param newMinimumWaitTime the new minimum wait time.
     */
    function setMinimumWaitTime(uint64 newMinimumWaitTime) public nonReentrant() onlyOwner() {
        require(newMinimumWaitTime != 0, "minimumWaitTime == 0");
        require(newMinimumWaitTime <= 4 weeks, "minimumWaitTime > 1 month");
        minimumWaitTime = newMinimumWaitTime;
        emit MinimumWaitTimeSet(newMinimumWaitTime);
    }

    /**
     * @notice Returns the current block timestamp.
     * @dev Can be overridden to control contract time.
     * @return the current block timestamp.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }
}
