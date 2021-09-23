// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/MessengerInterface.sol";

/**
 * @notice Implements the `relayMessage` trivially so that we can test whether the BridgeAdmin correctly calls into this
 * contract.
 */
contract MessengerMock is MessengerInterface {
    event RelayedMessage(address indexed target, uint32 gasLimit, bytes message);

    /**
     * @notice Sends a message to an account on L2.
     * @param target The intended recipient on L2.
     * @param gasLimit The gasLimit for the receipt of the message on L2.
     * @param message The data to send to the target (usually calldata to a function with
     *  `onlyFromCrossDomainAccount()`)
     */
    function relayMessage(
        address target,
        uint32 gasLimit,
        bytes memory message
    ) external override {
        emit RelayedMessage(target, gasLimit, message);
    }
}
