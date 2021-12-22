// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../../external/nomad/interfaces/XAppConnectionManagerInterface.sol";
import "../interfaces/ChildMessengerInterface.sol";
import "../interfaces/ChildMessengerConsumerInterface.sol";
import "../../common/implementation/Lockable.sol";
import "../../oracle/interfaces/FinderInterface.sol";
import "../../oracle/implementation/Constants.sol";

contract Nomad_ChildMessenger is ChildMessengerInterface, Lockable {
    FinderInterface public finder;

    uint256 public parentChainId;

    // Messenger contract on the other side of the L1<->L2 bridge.
    address public parentMessenger;

    // The only child network contract that can send messages over the bridge via the messenger is the OracleSpoke.
    address public oracleSpoke;
    // Store oracle hub address that OracleSpoke can send messages to via `sendMessageToParent`.
    address public oracleHub;

    event SetOracleSpoke(address newOracleSpoke);
    event SetOracleHub(address newOracleHub);
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
        // From solidity 8.10 docs: If you convert a type that uses a larger byte size to an address, for example
        // bytes32, then the address is truncated. To reduce conversion ambiguity version 0.4.24 and higher of the
        // compiler force you make the truncation explicit in the conversion. Take for example the 32-byte value
        // 0x111122223333444455556666777788889999AAAABBBBCCCCDDDDEEEEFFFFCCCC. You can use address(uint160(bytes20(b))),
        // which results in 0x111122223333444455556666777788889999aAaa, or you can use address(uint160(uint256(b))),
        // which results in 0x777788889999AaAAbBbbCcccddDdeeeEfFFfCcCc.
        address _addressToCheck = address(uint160(bytes20(addressToCheck)));
        require(parentMessenger == _addressToCheck, "cross-domain sender must be child messenger");
        _;
    }

    constructor(
        address _finderAddress,
        uint256 _parentChainId,
        address _parentMessenger
    ) {
        parentChainId = _parentChainId;
        finder = FinderInterface(_finderAddress);
    }

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

    function sendMessageToParent(bytes memory data) public override nonReentrant() {
        require(msg.sender == oracleSpoke, "Only callable by oracleSpoke");
        // Note: idea for converting address to bytes32 from this post: https://ethereum.stackexchange.com/a/55963
        getXAppConnectionManagerInterface().home().dispatch(
            uint32(parentChainId),
            bytes32(abi.encodePacked(oracleHub)),
            abi.encode(data, oracleHub)
        );
        emit MessageSentToParent(data, oracleHub, oracleSpoke);
    }

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
}
