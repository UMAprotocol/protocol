// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@maticnetwork/fx-portal/contracts/tunnel/FxBaseChildTunnel.sol";
import "../interfaces/ChildMessengerInterface.sol";
import "../interfaces/ChildMessengerConsumerInterface.sol";
import "../../common/implementation/Lockable.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../../data-verification-mechanism/implementation/Constants.sol";
import "../../common/implementation/HasFinder.sol";

/**
 * @notice Sends cross chain messages from Polygon to Ethereum network.
 * @dev This contract extends the `FxBaseChildTunnel` contract and therefore is 1-to-1 mapped with the
 * `FxBaseRootTunnel` extended by the `Polygon_ParentMessenger` contract deployed on Polygon. This mapping ensures that
 * the internal `_processMessageFromRoot` function is only callable indirectly by the `Polygon_ParentMessenger`.
 */
contract Polygon_ChildMessenger is FxBaseChildTunnel, ChildMessengerInterface, Lockable, HasFinder {
    event MessageSentToParent(bytes data, address indexed targetHub, address indexed oracleSpoke);
    event MessageReceivedFromParent(address indexed targetSpoke, bytes dataToSendToTarget);

    /**
     * @notice Construct the Polygon_ChildMessenger contract.
     * @param _finder Used to locate contracts for this network.
     * @param _fxChild Polygon system contract deployed on Mainnet, required to construct new FxBaseRootTunnel
     * that can send messages via native Polygon data tunnel.
     */
    constructor(address _fxChild, address _finder) FxBaseChildTunnel(_fxChild) HasFinder(_finder) {}

    /**
     * @notice Sends a message to the OracleSpoke via the parent messenger and the canonical message bridge.
     * @dev The caller must be the OracleSpoke on child network. No other contract is permissioned to call this
     * function.
     * @dev The L1 target, the parent messenger, must implement processMessageFromChild to consume the message.
     * @param data data message sent to the L1 messenger. Should be an encoded function call or packed data.
     */
    function sendMessageToParent(bytes memory data) public override nonReentrant() {
        require(msg.sender == getOracleSpoke(), "Only callable by oracleSpoke");
        _sendMessageToRoot(abi.encode(data, getOracleHub()));
        emit MessageSentToParent(data, getOracleHub(), getOracleSpoke());
    }

    /**
     * @notice Process a received message from the parent messenger via the canonical message bridge.
     * @dev The data will be received automatically from the state receiver when the state is synced between Ethereum
     * and Polygon. This will revert if the Root chain sender is not the `fxRootTunnel` contract.
     * @dev This call will revert if `setFxRoot` has not been called and the `sender` is not set to the
     * FxRoot contract address. FxRoot should be set to Polygon_ParentMessenger.
     * @param sender The sender of `data` from the Root chain.
     * @param data ABI encoded params with which to call function on OracleHub or GovernorHub.
     */
    function _processMessageFromRoot(
        uint256, /* stateId */
        address sender,
        bytes memory data
    ) internal override validateSender(sender) nonReentrant() {
        (bytes memory dataToSendToTarget, address target) = abi.decode(data, (bytes, address));
        ChildMessengerConsumerInterface(target).processMessageFromParent(dataToSendToTarget);
        emit MessageReceivedFromParent(target, dataToSendToTarget);
    }

    function getOracleSpoke() public view returns (address) {
        return finder.getImplementationAddress(OracleInterfaces.OracleSpoke);
    }

    function getOracleHub() public view returns (address) {
        return finder.getImplementationAddress(OracleInterfaces.OracleHub);
    }
}
