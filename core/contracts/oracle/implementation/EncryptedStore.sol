pragma solidity ^0.5.0;

/**
 * @title Contract for storing keyed encrypted messages via the EVM.
 * @dev This contract uses topic hashes as keys and can store a single arbitrary encrypted message per topic at any
 * given time.
 * @dev There's technically nothing that requires the topics hashed or for the messages to be encrypted.
 * @dev This contract is built for the following specific use case:
 * - The sender knows the topics ahead of time. This can either be communicated elsewhere or be implicit.
 * - Only one message per topic is stored at any given time.
 */
contract EncryptedStore {
    struct TopicData {
        // The encrypted message.
        bytes message;
    }

    struct Store {
        // This maps from a hash to the data for this topic.
        // Note: the hash is a hash of the "subject" or "topic" of the message.
        mapping(bytes32 => TopicData) topics;
    }

    // Mapping from addresses to topic hashes to encrypted messages
    mapping(address => Store) private stores;

    /**
     * @notice Gets the current stored message corresponding to `owner` and `topicHash`.
     * @dev To decrypt messages (this requires access to the owner's private keys), use the decryptMessage()
     * function in common/Crypto.js.
     */
    function getMessage(address owner, bytes32 topicHash) external view returns (bytes memory) {
        return stores[owner].topics[topicHash].message;
    }

    /**
     * @notice Sends `message` categorized by a particular `topicHash`. This will overwrite any
     * previous messages sent by this caller with this `topicHash`.
     * @dev To construct an encrypted message, use the encryptMessage() in common/Crypto.js.
     */
    function sendMessage(bytes32 topicHash, bytes memory message) public {
        Store storage ownerStore = stores[msg.sender];
        ownerStore.topics[topicHash].message = message;
    }

    function removeMessage(bytes32 topicHash) public {
        Store storage ownerStore = stores[msg.sender];
        delete ownerStore.topics[topicHash].message;
    }
}
