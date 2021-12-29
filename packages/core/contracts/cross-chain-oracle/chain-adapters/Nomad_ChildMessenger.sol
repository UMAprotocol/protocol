// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../external/nomad/interfaces/XAppConnectionManagerInterface.sol";
import "../interfaces/ChildMessengerInterface.sol";
import "../interfaces/ChildMessengerConsumerInterface.sol";
import "../../common/implementation/Lockable.sol";
import "../../oracle/implementation/Constants.sol";
import "../../common/implementation/HasFinder.sol";

/**
 * @notice Sends cross chain messages from any network where Nomad bridging infrastructure is deployed to L1. Both L1
 * and the network where this contract is deployed need to have Nomad Home + Replica contracts to send and receive
 * cross-chain messages respectively.
 */
contract Nomad_ChildMessenger is ChildMessengerInterface, Lockable, HasFinder {
    uint32 public parentChainDomain;

    event MessageSentToParent(
        bytes data,
        address indexed targetHub,
        address indexed oracleSpoke,
        uint32 parentChainDomain,
        address parentMessenger
    );
    event MessageReceivedFromParent(
        address indexed targetSpoke,
        bytes dataToSendToTarget,
        uint32 sourceDomain,
        address sourceSender
    );

    /**
     * @notice Only accept messages from a Nomad Replica contract
     */
    modifier onlyReplica(address addressToCheck) {
        // Determine whether addressToCheck is an enrolled Replica from the xAppConnectionManager
        require(getXAppConnectionManager().isReplica(addressToCheck), "msg.sender must be replica");
        _;
    }

    modifier crossChainSenderIsParentMessenger(bytes32 addressToCheck) {
        require(
            bytes32(uint256(uint160(getParentMessenger()))) == addressToCheck,
            "cross-domain sender must be child messenger"
        );
        _;
    }

    /**
     * @notice Construct the ChildMessenger contract.
     * @param _finder Used to locate contracts for this network.
     * @param _parentChainDomain The Nomad "domain" where the connected parent messenger is deployed. Note that the Nomad
     * domains do not always correspond to "chain ID's", but they are unique identifiers for each network.
     **/
    constructor(address _finder, uint32 _parentChainDomain) HasFinder(_finder) {
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
        getXAppConnectionManager().home().dispatch(
            parentChainDomain,
            bytes32(uint256(uint160(getParentMessenger()))),
            data
        );
        emit MessageSentToParent(data, getParentMessenger(), getOracleSpoke(), parentChainDomain, getParentMessenger());
    }

    /**
     * @notice Process a received message from the parent messenger via the Nomad Replica contract.
     * @dev The cross-chain caller must be the the parent messenger and the msg.sender for this function
     * must be the Replica contract.
     * @param _domain The domain the message is coming from.
     * @param _sender The address the message is coming from.
     * @param _message The message in the form of raw bytes.
     */
    function handle(
        uint32 _domain,
        bytes32 _sender,
        bytes memory _message
    ) external onlyReplica(msg.sender) crossChainSenderIsParentMessenger(_sender) {
        // TODO: Should we check that _domain == parentChainDomain?
        (bytes memory dataToSendToTarget, address target) = abi.decode(_message, (bytes, address));
        ChildMessengerConsumerInterface(target).processMessageFromParent(dataToSendToTarget);
        emit MessageReceivedFromParent(target, dataToSendToTarget, _domain, getParentMessenger());
    }

    function getXAppConnectionManager() public view returns (XAppConnectionManagerInterface) {
        return XAppConnectionManagerInterface(finder.getImplementationAddress(OracleInterfaces.XAppConnectionManager));
    }

    function getOracleSpoke() public view returns (address) {
        return finder.getImplementationAddress(OracleInterfaces.OracleSpoke);
    }

    function getParentMessenger() public view returns (address) {
        return finder.getImplementationAddress(OracleInterfaces.ParentMessenger);
    }
}
