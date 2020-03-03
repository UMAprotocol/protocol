pragma solidity ^0.5.0;


/**
 * @title Contract for storing keyed encrypted messages via the EVM.
 * @dev This contract uses topic hashes as keys and can store a single arbitrary encrypted message per topic at any
 * given time. Technically, topic hashes and messages do not need to be encrypted, but because
 * anyone can read stored messages, this contract is designed to store encrypted messages.
 * Only one message per topic is stored at any given time.
 */
contract EncryptedStore {
    // Mapping from users to hashes, which act as keys for encrypted messages.
    // Note: the hash is designed to be a hash of the "subject" or "topic" of the message.
    mapping(address => mapping(bytes32 => bytes)) private stores;

    /**
     * @notice Gets the current stored message corresponding to `user` and `topicHash`.
     * @dev To decrypt messages (this requires access to the owner's private keys), use the decryptMessage()
     * function in common/Crypto.js.
     * @param user address that stored this message.
     * @param topicHash hash of the "subject" of the message.
     * @return stored message.
     */
    function getMessage(address user, bytes32 topicHash) external view returns (bytes memory) {
        return stores[user][topicHash];
    }

    /**
     * @notice Stores a `message` categorized by a particular `topicHash`. This will overwrite the
     * previous messages sent by this caller with this `topicHash`.
     * @dev To construct an encrypted message, use the encryptMessage() in common/Crypto.js.
     * @param topicHash hash of the "subject" or "topic" of the message.
     * @param message the stored message.
     */
    function storeMessage(bytes32 topicHash, bytes memory message) public {
        stores[msg.sender][topicHash] = message;
    }

    /**
     * @notice Removes a stored message categorized by a particular `topicHash`.
     * @param topicHash hash of the "subject" or "topic" of the message.
     */
    function removeMessage(bytes32 topicHash) public {
        delete stores[msg.sender][topicHash];
    }
}
