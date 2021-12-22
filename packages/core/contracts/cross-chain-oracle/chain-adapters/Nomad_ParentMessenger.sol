// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../external/nomad/interfaces/XAppConnectionManagerInterface.sol";
import "../interfaces/ParentMessengerInterface.sol";
import "../interfaces/ParentMessengerConsumerInterface.sol";
import "./ParentMessengerBase.sol";
import "../../common/implementation/Lockable.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/implementation/Constants.sol";

contract Nomad_ParentMessenger is ParentMessengerInterface, ParentMessengerBase, Lockable {
    FinderInterface public finder;

    event MessageSentToChild(bytes data, address indexed targetSpoke);
    event MessageReceivedFromChild(address indexed targetHub, bytes dataToSendToTarget);

    modifier onlyChildMessenger(bytes32 addressToCheck) {
        // From solidity 8.10 docs: If you convert a type that uses a larger byte size to an address, for example
        // bytes32, then the address is truncated. To reduce conversion ambiguity version 0.4.24 and higher of the
        // compiler force you make the truncation explicit in the conversion. Take for example the 32-byte value
        // 0x111122223333444455556666777788889999AAAABBBBCCCCDDDDEEEEFFFFCCCC. You can use address(uint160(bytes20(b))),
        // which results in 0x111122223333444455556666777788889999aAaa, or you can use address(uint160(uint256(b))),
        // which results in 0x777788889999AaAAbBbbCcccddDdeeeEfFFfCcCc.
        address _addressToCheck = address(uint160(bytes20(addressToCheck)));
        require(childMessenger == _addressToCheck, "cross-domain sender must be child messenger");
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

    constructor(address _finderAddress, uint256 _childChainId) ParentMessengerBase(_childChainId) {
        finder = FinderInterface(_finderAddress);
    }

    function sendMessageToChild(bytes memory data) public override onlyHubContract() nonReentrant() {
        address target = msg.sender == oracleHub ? oracleSpoke : governorSpoke;
        bytes memory dataToSendToChild = abi.encode(data, target);
        // Note: idea for converting address to bytes32 from this post: https://ethereum.stackexchange.com/a/55963
        getXAppConnectionManagerInterface().home().dispatch(
            uint32(childChainId),
            bytes32(abi.encodePacked(target)),
            dataToSendToChild
        );
        emit MessageSentToChild(dataToSendToChild, target);
    }

    function handle(
        uint32,
        bytes32 _sender,
        bytes memory _message
    ) external onlyReplica(msg.sender) onlyChildMessenger(_sender) {
        (bytes memory dataToSendToTarget, address target) = abi.decode(_message, (bytes, address));
        ParentMessengerConsumerInterface(target).processMessageFromChild(childChainId, dataToSendToTarget);
        emit MessageReceivedFromChild(target, dataToSendToTarget);
    }

    function getXAppConnectionManagerInterface() public view returns (XAppConnectionManagerInterface) {
        return
            XAppConnectionManagerInterface(
                finder.getImplementationAddress(OracleInterfaces.XAppConnectionManagerInterface)
            );
    }
}
