// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@maticnetwork/fx-portal/contracts/tunnel/FxBaseRootTunnel.sol";
import "../interfaces/ParentMessengerInterface.sol";
import "../interfaces/ParentMessengerConsumerInterface.sol";
import "./ParentMessengerBase.sol";
import "../../common/implementation/Lockable.sol";

/**
 * @notice Sends cross chain messages from Ethereum to Polygon network.
 * @dev This contract extends the `FxBaseRootTunnel` contract and therefore is 1-to-1 mapped with the
 * `FxBaseChildTunnel` extended by the `Polygon_ChildMessenger` contract deployed on Polygon. This mapping ensures that
 * the internal `_processMessageFromChild` function is only callable indirectly by the `Polygon_ChildMessenger`.
 */
contract Polygon_ParentMessenger is FxBaseRootTunnel, ParentMessengerInterface, ParentMessengerBase, Lockable {
    event MessageSentToChild(bytes data, address indexed targetSpoke);
    event MessageReceivedFromChild(address indexed targetHub, bytes dataToSendToTarget);

    /**
     * @notice Construct the Optimism_ParentMessenger contract.
     * @param _checkpointManager The address of the Polygon checkpoint manager deployed on Mainnet. Required to
     * construct new FxBaseRootTunnel that can connect to native Polygon data tunnel.
     * @param _fxRoot Polygon system contract deployed on Mainnet, required to construct new FxBaseRootTunnel
     * that can send messages via native Polygon data tunnel.
     * @param _childChainId The chain id of the Optimism L2 network this messenger should connect to.
     **/
    constructor(
        address _checkpointManager,
        address _fxRoot,
        uint256 _childChainId
    ) FxBaseRootTunnel(_checkpointManager, _fxRoot) ParentMessengerBase(_childChainId) {}

    /**
     * @notice Sends a message to the child messenger via the canonical message bridge.
     * @dev The caller must be the either the OracleHub or the GovernorHub. This is to send either a
     * price or initiate a governance action to the OracleSpoke or GovernorSpoke on the child chain.
     * @dev The recipient of this message is the child messenger. The messenger must implement _processMessageFromRoot
     * which then forwards the data to the target either the OracleSpoke or the governorSpoke depending on the caller.
     * @param data data message sent to the child messenger. Should be an encoded function call or packed data.
     */
    function sendMessageToChild(bytes memory data) public override onlyHubContract() nonReentrant() {
        address target = msg.sender == oracleHub ? oracleSpoke : governorSpoke;
        bytes memory dataToSendToChild = abi.encode(data, target);
        _sendMessageToChild(dataToSendToChild);
        emit MessageSentToChild(dataToSendToChild, target);
    }

    /**
     * @notice Process a received message from the child messenger via the canonical message bridge.
     * @dev This internal method will be called inside `FxBaseRootTunnel.receiveMessage(bytes memory inputData)`,
     * which must be called by an EOA to finalize the relay of the message from Polygon to Ethereum.
     * The `inputData` is a proof of transaction that is derived from the transaction hash of the transaction on the
     * child chain that originated the cross-chain price request via _sendMessageToRoot.
     * @dev This call will revert if `setFxChild` has not been called. Fx Child should be set to Polygon_ChildMessenger.
     * @param data ABI encoded params with which to call function on OracleHub or GovernorHub.
     */
    function _processMessageFromChild(bytes memory data) internal override nonReentrant() {
        // We know that this internal execution can only be triggered by the ChildMessenger, which inherits
        // FxBaseChildTunnel and is mapped 1-to-1 with this contract's FxBaseRootTunnel via
        // `setFxRootTunnel/setFxChildTunnel`.
        (bytes memory dataToSendToTarget, address target) = abi.decode(data, (bytes, address));
        ParentMessengerConsumerInterface(target).processMessageFromChild(childChainId, dataToSendToTarget);
        emit MessageReceivedFromChild(target, dataToSendToTarget);
    }
}
