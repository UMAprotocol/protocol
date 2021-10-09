// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/MessengerInterface.sol";

/**
 * @notice Implements the `relayMessage` trivially so that we can test whether the BridgeAdmin correctly calls into this
 * contract.
 */
contract MessengerMock is MessengerInterface {
    event RelayedMessage(address indexed target, uint256 gasLimit, uint256 gasPrice, bytes message);

    /**
     * @notice Sends a message to an account on L2.
     * @param target The intended recipient on L2.
     * @param gasLimit The gasLimit for the receipt of the message on L2.
     * @param gasPrice Gas price bid for L2 transaction.
     * @param message The data to send to the target (usually calldata to a function with
     *  `onlyFromCrossDomainAccount()`)
     */
    function relayMessage(
        address target,
        address,
        uint256,
        uint256 gasLimit,
        uint256 gasPrice,
        uint256,
        bytes memory message
    ) external payable override {
        emit RelayedMessage(target, gasLimit, gasPrice, message);
    }
}
