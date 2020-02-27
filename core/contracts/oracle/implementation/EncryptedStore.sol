pragma solidity ^0.5.0;

/**
 * @title Contract for storing keyed encrypted messages via the EVM. Only authorized senders can store
 * messages for a given address' store.
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
        // This contains the set of all authorized senders for this store.
        mapping(address => bool) authorizedSenders;
    }

    mapping(address => Store) private stores;

    /**
     * @notice Returns true if the `sender` is authorized to store data to the `owner` of the store.
     */
    function isAuthorizedSender(address sender, address owner) public view returns (bool) {
        // Note: the sender is always authorized to store messages to themselves.
        return stores[owner].authorizedSenders[sender] || owner == sender;
    }

    /**
     * @notice Authorizes `sender` to store messages to the caller's store.
     */
    function addAuthorizedSender(address sender) external {
        stores[msg.sender].authorizedSenders[sender] = true;
    }

    /**
     * @notice Revokes `sender`'s authorization to store messages to the caller's store.
     */
    function removeAuthorizedSender(address sender) external {
        stores[msg.sender].authorizedSenders[sender] = false;
    }

    /**
     * @notice Gets the current stored message corresponding to `owner` and `topicHash`.
     * @dev To decrypt messages (this requires access to the recipient's private keys), use the decryptMessage()
     * function in common/Crypto.js.
     */
    function getMessage(address owner, bytes32 topicHash) external view returns (bytes memory) {
        return stores[owner].topics[topicHash].message;
    }

    /**
     * @notice Sends `message` to `owner` categorized by a particular `topicHash`. This will overwrite any
     * previous messages sent to this `owner` with this `topicHash`.
     * @dev To construct an encrypted message, use the encryptMessage() in common/Crypto.js.
     */
    function sendMessage(address owner, bytes32 topicHash, bytes memory message) public {
        Store storage ownerStore = stores[owner];
        require(isAuthorizedSender(msg.sender, owner), "Not authorized to send to this store");
        ownerStore.topics[topicHash].message = message;
    }

    function removeMessage(address owner, bytes32 topicHash) public {
        Store storage ownerStore = stores[owner];
        require(isAuthorizedSender(msg.sender, owner), "Not authorized to remove message");
        delete ownerStore.topics[topicHash].message;
    }
}
