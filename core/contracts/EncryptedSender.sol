/*
  EncryptedSender contract for sending encrypted messages via the EVM.
*/
pragma solidity ^0.5.0;


/**
 * @title Simple keyed encrypted message sender.
 * @dev This contract uses topic hashes as keys and can store a single arbitrary encrypted message per topic at any
 * given time. Note: there's technically nothing that requires the topics hashed or for the messages to be encrypted.
 * This contract is built for the following specific use case:
 * - The sender and recipient know the topics ahead of time. This can either be communicated elsewhere or be implicit.
 * - Only one message per topic is stored at any given time.
 * - Only addresses that are authorized by the recipient can send messages. These authorized parties can overwrite, but
 * not delete the previous message for a particular topic.
 */
contract EncryptedSender {
    struct Recipient {
        // This maps from a hash to an encrypted message.
        // Note: the hash is a hash of the "subject" or "topic" of the message.
        mapping(bytes32 => bytes) messages;

        // This contains the set of all authorized senders for this recipient.
        mapping(address => bool) authorizedSenders;

        // A public key for the recipient that can be used to send messages to the recipient.
        bytes publicKey;
    }

    mapping(address => Recipient) private recipients;

    /**
     * @notice Authorizes `sender` to send messages to the caller.
     */
    function addAuthorizedSender(address sender) external {
        recipients[msg.sender].authorizedSenders[sender] = true;
    }

    /**
     * @notice Revokes `sender`'s authorization to send messages to the caller.
     */
    function removeAuthorizedSender(address sender) external {
        recipients[msg.sender].authorizedSenders[sender] = false;
    }

    /**
     * @notice Gets the current stored message corresponding to `recipient` and `topicHash`.
     * @dev To decrypt messages (this requires access to the recipient's private keys), use the decryptMessage()
     * function in core/utils/Crypto.js. 
     */
    function getMessage(address recipient, bytes32 topicHash) external view returns (bytes memory) {
        return recipients[recipient].messages[topicHash];
    }

    /**
     * @notice Gets the stored public key for `recipient`. Return value will be 0 length if no public key has been set.
     * @dev Senders will need this public key to encrypt messages that only the `recipient` can read.
     */
    function getPublicKey(address recipient) external view returns (bytes memory) {
        return recipients[recipient].publicKey;
    }

    /**
     * @notice Sends `message` to `recipient_` categorized by a particular `topicHash`. This will overwrite any
     * previous messages sent to this `recipient` with this `topicHash`.
     * @dev To construct an encrypted message, use the encryptMessage() in core/utils/Crypto.js.
     * The public key for the recipient can be obtained using the getPublicKey() method.
     */
    function sendMessage(address recipient_, bytes32 topicHash, bytes memory message) public {
        Recipient storage recipient = recipients[recipient_];
        require(recipient.authorizedSenders[msg.sender], "Not authorized to send to this recipient");
        recipient.messages[topicHash] = message;
    }

    /**
     * @notice Sets the caller's public key.
     */
    function setPublicKey(bytes memory publicKey) public {
        // Verify that the uploaded public key matches the sender.
        require(_publicKeyToAddress(publicKey) == msg.sender);

        // Set the public key if it passed verification.
        recipients[msg.sender].publicKey = publicKey;
    }

    /**
     * @notice Converts the public key to an address.
     * @dev Conversion fails if the public key is not 64 bytes.
     */
    function _publicKeyToAddress(bytes memory publicKey) private pure returns (address) {
        require(publicKey.length == 64, "Public key is the wrong length");
        return address(uint256(keccak256(publicKey)));
    }
}
