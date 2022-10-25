// Copied logic from https://github.com/makerdao/arbitrum-dai-bridge/blob/34acc39bc6f3a2da0a837ea3c5dbc634ec61c7de/contracts/l1/L1CrossDomainEnabled.sol
// with a change to the solidity version.
pragma solidity ^0.8.0;

import "../../external/avm/interfaces/iArbitrum_Inbox.sol";
import "../../external/avm/interfaces/iArbitrum_Outbox.sol";

abstract contract Arbitrum_CrossDomainEnabled {
    iArbitrum_Inbox public immutable inbox;

    /**
     * @param _inbox Contract that sends generalized messages to the Arbitrum chain.
     */
    constructor(address _inbox) {
        inbox = iArbitrum_Inbox(_inbox);
    }

    // More details about retryable ticket parameters here: https://developer.offchainlabs.com/docs/l1_l2_messages#parameters
    // This function will not apply aliassing to the `user` address on L2.
    // Note: If `l1CallValue > 0`, then this contract must contain at least that much ETH to send as msg.value to the
    // inbox.
    function sendTxToL2NoAliassing(
        address target, // Address where transaction will initiate on L2.
        address user, // Address where excess gas is credited on L2.
        uint256 l1CallValue, // msg.value deposited to `user` on L2.
        uint256 maxSubmissionCost, // Amount of ETH allocated to pay for base submission fee. The user is charged this
        // fee to cover the storage costs of keeping their retryable ticket's calldata in the retry buffer. This should
        // also cover the `l2CallValue`, but we set that to 0. This amount is proportional to the size of `data`.
        uint256 maxGas, // Gas limit for immediate L2 execution attempt.
        uint256 gasPriceBid, // L2 gas price bid for immediate L2 execution attempt.
        bytes memory data // ABI encoded data to send to target.
    ) internal returns (uint256) {
        // createRetryableTicket API: https://developer.offchainlabs.com/docs/sol_contract_docs/md_docs/arb-bridge-eth/bridge/inbox#createretryableticketaddress-destaddr-uint256-l2callvalue-uint256-maxsubmissioncost-address-excessfeerefundaddress-address-callvaluerefundaddress-uint256-maxgas-uint256-gaspricebid-bytes-data-%E2%86%92-uint256-external
        // - address destAddr: destination L2 contract address
        // - uint256 l2CallValue: call value for retryable L2 message
        // - uint256 maxSubmissionCost: Max gas deducted from user's L2 balance to cover base submission fee
        // - address excessFeeRefundAddress: maxgas x gasprice - execution cost gets credited here on L2
        // - address callValueRefundAddress: l2CallValue gets credited here on L2 if retryable txn times out or gets cancelled
        // - uint256 maxGas: Max gas deducted from user's L2 balance to cover L2 execution
        // - uint256 gasPriceBid: price bid for L2 execution
        // - bytes data: ABI encoded data of L2 message
        uint256 seqNum =
            inbox.createRetryableTicketNoRefundAliasRewrite{ value: l1CallValue }(
                target,
                0, // we always assume that l2CallValue = 0
                maxSubmissionCost,
                user,
                user,
                maxGas,
                gasPriceBid,
                data
            );
        return seqNum;
    }

    // Copied mostly from: https://github.com/makerdao/arbitrum-dai-bridge/blob/34acc39bc6f3a2da0a837ea3c5dbc634ec61c7de/contracts/l1/L1CrossDomainEnabled.sol#L31
    modifier onlyFromCrossDomainAccount(address l2Counterpart) {
        // a message coming from the counterpart gateway was executed by the bridge
        IBridge bridge = IBridge(inbox.bridge());
        require(msg.sender == address(bridge), "NOT_FROM_BRIDGE");

        // and the outbox reports that the L2 address of the sender is the counterpart gateway
        address l2ToL1Sender = iArbitrum_Outbox(bridge.activeOutbox()).l2ToL1Sender();
        require(l2ToL1Sender == l2Counterpart, "ONLY_COUNTERPART_GATEWAY");
        _;
    }
}
