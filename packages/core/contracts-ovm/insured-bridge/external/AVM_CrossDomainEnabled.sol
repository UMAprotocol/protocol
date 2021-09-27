pragma solidity ^0.8.0;

import "./iAVM_Inbox.sol";

abstract contract AVM_CrossDomainEnabled {
    modifier onlyFromCrossDomainAccount(address l1Counterpart) {
        require(msg.sender == applyL1ToL2Alias(l1Counterpart), "ONLY_COUNTERPART_GATEWAY");
        _;
    }

    uint160 constant offset = uint160(0x1111000000000000000000000000000000001111);
    iAVM_Inbox public immutable inbox;

    /**
     * @param _inbox Contract that sends generalized messages to the Arbitrum chain.
     */
    constructor(address _inbox) {
        inbox = iAVM_Inbox(_inbox);
    }

    // l1 addresses are transformed during l1->l2 calls. see https://developer.offchainlabs.com/docs/l1_l2_messages#address-aliasing for more information.
    function applyL1ToL2Alias(address l1Address) internal pure returns (address l2Address) {
        l2Address = address(uint160(l1Address) + offset);
    }

    // More details about retryable ticket parameters here: https://developer.offchainlabs.com/docs/l1_l2_messages#parameters
    // This function will not apply aliassing to the `user` address on L2.
    function sendTxToL2NoAliassing(
        address target, // Address where transaction will initiate on L2.
        address user, // Address where excess gas is credited on L2.
        uint256 maxSubmissionCost, // Amount of ETH allocated to pay for base submission fee. The user is charged this
        // fee to cover the storage costs of keeping their retryable ticket's calldata in the retry buffer.
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
            inbox.createRetryableTicketNoRefundAliasRewrite(
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
}
