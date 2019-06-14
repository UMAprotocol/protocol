/*
  Simple Address Whitelist
*/
pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";


/**
 * @title Simple keyed encrypted message sender.
 * @dev This contract uses topics as keys and can store a single arbitrary encrypted message per topic at any given
 * time. Note: there's nothing that requires the topics to be hashes or for the messages to be encrypted.
 * This library is built for the following specific use case:
 * - The sender and recipient know the topics ahead of time. This can either be communicated elsewhere or be implicit.
 * - Only one message per topic is stored at any given time.
 * - Only addresses that are authorized by the recipient can send messages. These authorized parties can overwrite, but
 * not delete the previous message for a particular topic.
 */
contract EncryptedSender {
    event Log(bytes32 a, bytes32 b);

    struct Recipient {
        // This maps from a hash to an encrypted message.
        // Note: the hash is a hash of the "subject" or "topic" of the message.
        mapping(bytes32 => bytes) messages;

        // This contains the set of all authorized senders for this recipient.
        mapping(address => bool) authorizedSenders;

        // Signature data so senders can recover the public key of the recipient.
        // Note: the sender should be signing a hash of their own address.
        bytes signature;
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
     * @notice Gets the stored signature for `recipient`. Return value will be 0 length if no signature has been set.
     * @dev The signature is necessary to recover the `recipient`'s public key. Senders will need this public key to
     * encrypt messages that only the `recipient` can read.
     */
    function getSignature(address recipient) external view returns (bytes memory) {
        return recipients[recipient].signature;
    }

    /**
     * @notice Sends `message` to `recipient_` categorized by a particular `topicHash`. This will overwrite any
     * previous messages sent to this `recipient` with this `topicHash`.
     * @dev To construct an encrypted message, use the encryptMessageFromSignature() in core/utils/Crypto.js.
     * The signature for the recipient can be retrieved using the getSignature() in this contract, and the standard
     * message that all recipients sign is "EncryptedSender".
     */
    function sendMessage(address recipient_, bytes32 topicHash, bytes memory message) public {
        Recipient storage recipient = recipients[recipient_];
        require(recipient.authorizedSenders[msg.sender], "Not authorized to send to this recipient");
        recipient.messages[topicHash] = message;
    }

    /**
     * @notice Sets the caller's stored signature.
     * @dev The signature must be on the message "EncryptedSender" and it must be constructed in a particular way.
     * See signMessage() core/utils/Crypto.js for how this signature can be constructed.
     */
    function setSignature(bytes memory signature) public {
        // Generate the hash of the unique message we use for verification.
        bytes32 innerMessageHash = keccak256(abi.encodePacked("EncryptedSender"));

        // Create an external hash of the inner message along with a standard wrapper message.
        bytes32 messageHash = ECDSA.toEthSignedMessageHash(innerMessageHash);

        // Recover the address that signed the message and verify.
        address signingAddress = ECDSA.recover(messageHash, signature);
        require(signingAddress != address(0), "Invalid signature");
        require(signingAddress == msg.sender, "Signing address does not match the sender");

        // Set the signature if it passed verification.
        recipients[msg.sender].signature = signature;
    }
}
