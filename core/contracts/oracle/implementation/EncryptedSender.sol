pragma solidity ^0.5.0;

/**
 * @title Contract for sending keyed encrypted messages via the EVM
 * @dev This contract uses topic hashes as keys and can store a single arbitrary encrypted message per topic at any
 * given time. Note: there's technically nothing that requires the topics hashed or for the messages to be encrypted.
 * This contract is built for the following specific use case:
 * - The sender and recipient know the topics ahead of time. This can either be communicated elsewhere or be implicit.
 * - Only one message per topic is stored at any given time.
 * - Only addresses that are authorized by the recipient can send messages.
 * These authorized parties can overwrite, but not delete the previous message for a particular topic.
 */
contract EncryptedSender {
    /****************************************
     *     DATA STRUCTURES AND STORAGE      *
     ****************************************/

    struct TopicData {
        // An (optional) public key used to encrypt messages for this topic.
        // This is only necessary if the sender will not have access to the public key offchain.
        bytes publicKey;
        // The encrypted message.
        bytes message;
    }

    struct Recipient {
        // This maps from a hash to the data for this topic.
        // Note: the hash is a hash of the "subject" or "topic" of the message.
        mapping(bytes32 => TopicData) topics;
        // This contains the set of all authorized senders for this recipient.
        mapping(address => bool) authorizedSenders;
    }

    mapping(address => Recipient) private recipients;

    /****************************************
     *   SENDING AND SETTING SENDER INFO    *
     ****************************************/

    /**
     * @notice Authorizes `sender` to send messages to the caller.
     * @param sender address to add the authorized sender to.
     */
    function addAuthorizedSender(address sender) external {
        recipients[msg.sender].authorizedSenders[sender] = true;
    }

    /**
     * @notice Revokes `sender`'s authorization to send messages to the caller.
     * @param sender address of of the authorized sender to remove.
     */
    function removeAuthorizedSender(address sender) external {
        recipients[msg.sender].authorizedSenders[sender] = false;
    }

    /**
     * @notice Sends `message` to `recipient_` categorized by a particular `topicHash`. This will overwrite any
     * previous messages sent to this `recipient` with this `topicHash`.
     * @dev To construct an encrypted message, use the encryptMessage() in common/Crypto.js.
     * The public key for the recipient can be obtained using the getPublicKey() method.
     */
    function sendMessage(address recipient_, bytes32 topicHash, bytes memory message) public {
        Recipient storage recipient = recipients[recipient_];
        require(isAuthorizedSender(msg.sender, recipient_), "Not authorized to send to this recipient");
        recipient.topics[topicHash].message = message;
    }

    function removeMessage(address recipient_, bytes32 topicHash) public {
        Recipient storage recipient = recipients[recipient_];
        require(isAuthorizedSender(msg.sender, recipient_), "Not authorized to remove message");
        delete recipient.topics[topicHash].message;
    }

    /**
     * @notice Sets the public key for this caller and topicHash.
     * @dev setting the public key is optional - if the publicKey is communicated or can be derived offchain by
     * the sender, there is no need to set it here.  Because there are no specific requirements for the
     * publicKey, there is also no verification of its validity other than its length.
     */
    function setPublicKey(bytes memory publicKey, bytes32 topicHash) public {
        require(publicKey.length == 64, "Public key is the wrong length");
        recipients[msg.sender].topics[topicHash].publicKey = publicKey;
    }

    /**
     * @notice Returns true if the `sender` is authorized to send to the `recipient`.
     */

    /****************************************
     *        ENCRYPTED DATA GETTERS        *
     ****************************************/

    /**
     * @notice Gets the current stored message corresponding to `recipient` and `topicHash`.
     * @dev To decrypt messages (this requires access to the recipient's private keys), use the decryptMessage()
     * function in common/Crypto.js.
     */
    function getMessage(address recipient, bytes32 topicHash) external view returns (bytes memory) {
        return recipients[recipient].topics[topicHash].message;
    }

    /**
     * @notice Gets the stored public key for a particular `recipient` and `topicHash`. Return value will be 0 length
     * if no public key has been set.
     * @dev Senders may need this public key to encrypt messages that only the `recipient` can read. If the public key
     * is communicated offchain, this field may be left empty.
     */
    function getPublicKey(address recipient, bytes32 topicHash) external view returns (bytes memory) {
        return recipients[recipient].topics[topicHash].publicKey;
    }

    function isAuthorizedSender(address sender, address recipient) public view returns (bool) {
        // Note: the recipient is always authorized to send messages to themselves.
        return recipients[recipient].authorizedSenders[sender] || recipient == sender;
    }
}
