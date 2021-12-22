// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../external/nomad/interfaces/XAppConnectionManagerInterface.sol";
import "../interfaces/ChildMessengerInterface.sol";
import "../interfaces/ChildMessengerConsumerInterface.sol";
import "../../common/implementation/Lockable.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/implementation/Constants.sol";

/**
 * @notice Sends cross chain messages from any network where Nomad bridging infrastructure is deployed to L1. Both L1
 * and the network where this contract is deployed need to have Nomad Home + Replica contracts to send and receive
 * cross-chain messages.
 */
contract Nomad_ChildMessenger is ChildMessengerInterface, Lockable {
    FinderInterface public finder;

    uint32 public parentChainDomain;

    event MessageSentToParent(bytes data, address indexed targetHub, address indexed oracleSpoke);
    event MessageReceivedFromParent(address indexed targetSpoke, bytes dataToSendToTarget);

    /**
     * @notice Only accept messages from an Nomad Replica contract
     */
    modifier onlyReplica(address addressToCheck) {
        // Determine whether addressToCheck is an enrolled Replica from the xAppConnectionManager
        require(getXAppConnectionManagerInterface().isReplica(addressToCheck), "msg.sender must be replica");
        _;
    }

    modifier onlyParentMessenger(bytes32 addressToCheck) {
        // Note: idea for converting address to bytes32 from this post: https://ethereum.stackexchange.com/a/55963
        require(
            bytes32(abi.encodePacked(getParentMessenger())) == addressToCheck,
            "cross-domain sender must be child messenger"
        );
        _;
    }

    /**
     * @notice Construct the ChildMessenger contract.
     * @param _finder Used to locate XAppConnectionManager for this network.
     * @param _parentChainDomain The Nomad "domain" where the connected parent messenger is deployed. Note that the Nomad
     * domains do not always correspond to "chain ID's", but they are similarly unique identifiers for each network.
     **/
    constructor(address _finder, uint32 _parentChainDomain) {
        finder = FinderInterface(_finder);
        parentChainDomain = _parentChainDomain; // TODO: Figure out how to upgrade this value.
    }

    /**
     * @notice Sends a message to the parent messenger via the Home contract.
     * @dev The caller must be the OracleSpoke on L2. No other contract is permissioned to call this function.
     * @dev The L1 target, the parent messenger, must implement processMessageFromChild to consume the message.
     * @param data data message sent to the L1 messenger. Should be an encoded function call or packed data.
     */
    function sendMessageToParent(bytes memory data) public override nonReentrant() {
        require(msg.sender == getOracleSpoke(), "Only callable by oracleSpoke");
        getXAppConnectionManagerInterface().home().dispatch(
            parentChainDomain,
            // Note: idea for converting address to bytes32 from this post: https://ethereum.stackexchange.com/a/55963
            bytes32(abi.encodePacked(getParentMessenger())),
            data
        );
        emit MessageSentToParent(data, getParentMessenger(), getOracleSpoke());
    }

    /**
     * @notice Process a received message from the parent messenger via the Nomad Replica contract.
     * @dev The cross-chain caller must be the the parent messenger and the msg.sender on this network
     * must be the Replica contract.
     * @param _sender The address the message is coming from
     * @param _message The message in the form of raw bytes
     */
    function handle(
        uint32,
        bytes32 _sender,
        bytes memory _message
    ) external onlyReplica(msg.sender) onlyParentMessenger(_sender) {
        (bytes memory dataToSendToTarget, address target) = abi.decode(_message, (bytes, address));
        ChildMessengerConsumerInterface(target).processMessageFromParent(dataToSendToTarget);
        emit MessageReceivedFromParent(target, dataToSendToTarget);
    }

    function getXAppConnectionManagerInterface() public view returns (XAppConnectionManagerInterface) {
        return
            XAppConnectionManagerInterface(
                finder.getImplementationAddress(OracleInterfaces.XAppConnectionManagerInterface)
            );
    }

    function getOracleSpoke() public view returns (address) {
        return finder.getImplementationAddress(OracleInterfaces.OracleSpoke);
    }

    function getParentMessenger() public view returns (address) {
        return finder.getImplementationAddress(OracleInterfaces.ParentMessenger);
    }
}
