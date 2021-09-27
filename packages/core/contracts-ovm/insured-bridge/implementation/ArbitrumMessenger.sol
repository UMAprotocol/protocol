// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../external/AVM_CrossDomainEnabled.sol";
import "../interfaces/MessengerInterface.sol";

/**
 * @notice Sends cross chain messages Arbitrum L2 network.
 */
contract ArbitrumMessenger is AVM_CrossDomainEnabled, MessengerInterface {
    /**
     * @param _inbox Contract that sends generalized messages to the Arbitrum chain.
     */
    constructor(address _inbox) AVM_CrossDomainEnabled(_inbox) {}

    /**
     * @notice Sends a message to an account on L2.
     * @param target The intended recipient on L2.
     * @param gasLimit The gasLimit for the receipt of the message on L2.
     * @param gasPrice Gas price bid for L2 execution.
     * @param message The data to send to the target (usually calldata to a function with
     *  `onlyFromCrossDomainAccount()`)
     */
    function relayMessage(
        address target,
        uint256 gasLimit,
        uint256 gasPrice,
        bytes memory message
    ) external override {
        // Since we know the L2 target's address in advance, we don't need to alias an L1 address.
        sendTxToL2NoAliassing(
            target,
            target, // send any excess ether to the L2 deposit box.
            0, // TODO: Determine the max submission cost. From the docs: "current base submission fee is queryable via ArbRetryableTx.getSubmissionPrice"
            gasLimit,
            gasPrice,
            message
        );
    }
}
