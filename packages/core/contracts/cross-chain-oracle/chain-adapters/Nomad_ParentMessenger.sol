// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../external/nomad/interfaces/XAppConnectionManagerInterface.sol";
import "../interfaces/ParentMessengerInterface.sol";
import "../interfaces/ParentMessengerConsumerInterface.sol";
import "./ParentMessengerBase.sol";
import "../../common/implementation/Lockable.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/implementation/Constants.sol";

/**
 * @notice Sends cross chain messages from Ethereum L1 to any other network where Nomad bridging infrastructure is
 * deployed. Both L1 and the network where the child messenger is deployed need to have Nomad Home + Replica contracts
 * to send and receive cross-chain messages.
 * @dev This contract is ownable and should be owned by the DVM governor.
 */
contract Nomad_ParentMessenger is ParentMessengerInterface, ParentMessengerBase, Lockable {
    FinderInterface public finder;

    event MessageSentToChild(bytes data, address indexed targetSpoke, address indexed childMessenger);
    event MessageReceivedFromChild(bytes data, address indexed childMessenger, address indexed targetHub);

    modifier onlyChildMessenger(bytes32 addressToCheck) {
        // Note: idea for converting address to bytes32 from this post: https://ethereum.stackexchange.com/a/55963
        require(
            bytes32(abi.encodePacked(childMessenger)) == addressToCheck,
            "cross-domain sender must be child messenger"
        );
        _;
    }

    /**
     * @notice Only accept messages from an Nomad Replica contract
     */
    modifier onlyReplica(address addressToCheck) {
        // Determine whether addressToCheck is an enrolled Replica from the xAppConnectionManager
        require(getXAppConnectionManagerInterface().isReplica(addressToCheck), "msg.sender must be replica");
        _;
    }

    /**
     * @notice Construct the ParentMessenger contract.
     * @param _finder Used to locate XAppConnectionManager for this network.
     * @param _childChainDomain The Nomad "domain" where the connected child messenger is deployed. Note that the Nomad
     * domains do not always correspond to "chain ID's", but they are similarly unique identifiers for each network.
     **/
    constructor(address _finder, uint256 _childChainDomain) ParentMessengerBase(_childChainDomain) {
        finder = FinderInterface(_finder);
    }

    /**
     * @notice Sends a message to the child messenger via the Nomad Home contract.
     * @dev The caller must be the either the OracleHub or the GovernorHub. This is to send either a
     * price or initiate a governance action to the OracleSpoke or GovernorSpoke on the child network.
     * @dev The recipient of this message is the child messenger. The messenger must implement Nomad specific
     * function called "handle" which then forwards the data to the target either the OracleSpoke or the governorSpoke
     * depending on the caller.
     * @dev This function will only succeed if this contract has enough ETH to cover the approximate L1 call value.
     * @param data data message sent to the child messenger. Should be an encoded function call or packed data.
     */
    function sendMessageToChild(bytes memory data) public override onlyHubContract() nonReentrant() {
        address target = msg.sender == oracleHub ? oracleSpoke : governorSpoke;
        bytes memory dataToSendToChild = abi.encode(data, target);
        // Note: idea for converting address to bytes32 from this post: https://ethereum.stackexchange.com/a/55963
        getXAppConnectionManagerInterface().home().dispatch(
            uint32(childChainId), // chain ID and the Nomad idea of a "domain" are used interchangeably.
            bytes32(abi.encodePacked(target)),
            dataToSendToChild
        );
        emit MessageSentToChild(dataToSendToChild, target, childMessenger);
    }

    /**
     * @notice Process a received message from the child messenger via the Nomad Replica contract.
     * @dev The cross-chain caller must be the the child messenger and the msg.sender on this network
     * must be the Replica contract.
     * @dev Note that only the OracleHub can receive messages from the child messenger. Therefore we can always forward
     * these messages to this contract. The OracleHub must implement processMessageFromChild to handle this message.
     * @param _sender The address the message is coming from
     * @param _message The message in the form of raw bytes
     */
    function handle(
        uint32,
        bytes32 _sender,
        bytes memory _message
    ) external onlyReplica(msg.sender) onlyChildMessenger(_sender) {
        ParentMessengerConsumerInterface(oracleHub).processMessageFromChild(childChainId, _message);
        emit MessageReceivedFromChild(_message, childMessenger, oracleHub);
    }

    function getXAppConnectionManagerInterface() public view returns (XAppConnectionManagerInterface) {
        return XAppConnectionManagerInterface(finder.getImplementationAddress(OracleInterfaces.XAppConnectionManager));
    }
}
