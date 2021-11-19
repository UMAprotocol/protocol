// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../external/polygon/tunnel/FxBaseChildTunnel.sol";
import "../interfaces/ChildMessengerInterface.sol";
import "../interfaces/ChildMessengerConsumerInterface.sol";
import "../../common/implementation/Lockable.sol";

/**
 * @notice Sends cross chain messages from Polygon to Ethereum network.
 * @dev This contract extends the `FxBaseChildTunnel` contract and therefore is 1-to-1 mapped with the
 * `FxBaseRootTunnel` extended by the `Polygon_ParentMessenger` contract deployed on Polygon. This mapping ensures that
 * the internal `_processMessageFromRoot` function is only callable indirectly by the `Polygon_ParentMessenger`.
 */
contract Polygon_ChildMessenger is FxBaseChildTunnel, ChildMessengerInterface, Lockable {
    // The only child network contract that can send messages over the bridge via the messenger is the OracleSpoke.
    address public oracleSpoke;
    // Store oracle hub address that OracleSpoke can send messages to via `sendMessageToParent`.
    address public oracleHub;

    event SetOracleSpoke(address newOracleSpoke);
    event SetOracleHub(address newOracleHub);
    event MessageSentToParent(bytes data, address indexed targetHub);
    event MessageReceivedFromParent(address indexed targetSpoke, bytes dataToSendToTarget);

    /**
     * @notice Construct the Polygon_ChildMessenger contract.
     * @param _fxChild Polygon system contract deployed on Mainnet, required to construct new FxBaseRootTunnel
     * that can send messages via native Polygon data tunnel.
     */
    constructor(address _fxChild) FxBaseChildTunnel(_fxChild) {}

    /**
     * @notice Set OracleSpoke address, which is the only address that can call `sendMessageToParent`.
     * @dev Can only reset this address once.
     * @param _oracleSpoke address of the new OracleSpoke, deployed on this network.
     */
    function setOracleSpoke(address _oracleSpoke) public nonReentrant() {
        require(oracleSpoke == address(0x0), "OracleSpoke already set");
        oracleSpoke = _oracleSpoke;
        emit SetOracleSpoke(oracleSpoke);
    }

    /**
     * @notice Set OracleHub address, which is always the target address for messages sent from this network to
     * the parent network.
     * @dev Can only reset this address once.
     * @param _oracleHub address of the new OracleHub, deployed on the parent network.
     */
    function setOracleHub(address _oracleHub) public nonReentrant() {
        require(oracleHub == address(0x0), "OracleHub already set");
        oracleHub = _oracleHub;
        emit SetOracleHub(oracleHub);
    }

    /**
     * @notice Sends a message to the OracleSpoke via the parent messenger and the canonical message bridge.
     * @dev The caller must be the OracleSpoke on child network. No other contract is permissioned to call this
     * function.
     * @dev The L1 target, the parent messenger, must implement processMessageFromChild to consume the message.
     * @param data data message sent to the L1 messenger. Should be an encoded function call or packed data.
     */
    function sendMessageToParent(bytes memory data) public override nonReentrant() {
        require(msg.sender == oracleSpoke, "Only callable by oracleSpoke");
        _sendMessageToRoot(abi.encode(data, oracleHub));
        emit MessageSentToParent(data, oracleHub);
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
}
