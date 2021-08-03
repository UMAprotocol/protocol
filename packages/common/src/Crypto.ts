import EthCrypto from "eth-crypto";
import type Web3 from "web3";
import assert from "assert";

interface KeyPair {
  privateKey: string;
  publicKey: string;
}

// Encrypts a message using an ethereum public key. To decrypt messages that are encrypted with this method, use
// decryptMessage().
export async function encryptMessage(publicKey: string, message: string): Promise<string> {
  // substr(2) removes the web3 friendly "0x" from the public key.
  const encryptedMessageObject = await EthCrypto.encryptWithPublicKey(publicKey.substr(2), message);
  return "0x" + EthCrypto.cipher.stringify(encryptedMessageObject);
}

// Converts an ethereum public key to the corresponding address.
export function addressFromPublicKey(publicKey: string): string {
  // substr(2) just removes the web3 friendly "0x" from the public key.
  return EthCrypto.publicKey.toAddress(publicKey.substr(2));
}

// Recovers a public key from a private key.
export function recoverPublicKey(privateKey: string): string {
  // The "0x" is added to make the public key web3 friendly.
  return "0x" + EthCrypto.publicKeyByPrivateKey(privateKey);
}

// Decrypts a message that was encrypted using encryptMessage().
export async function decryptMessage(privKey: string, encryptedMessage: string): Promise<string> {
  // substr(2) just removes the 0x at the beginning. parse() reverses the stringify() in encryptMessage().
  const encryptedMessageObject = EthCrypto.cipher.parse(encryptedMessage.substr(2));
  return await EthCrypto.decryptWithPrivateKey(privKey, encryptedMessageObject);
}

// Derives a private key from a signature.
export async function deriveKeyPair(web3: Web3, signature: string): Promise<KeyPair> {
  const hashOutput = web3.utils.soliditySha3(signature);
  assert(hashOutput, "hash returned null");
  const privateKey = hashOutput.substr(2);
  const publicKey = recoverPublicKey(privateKey);
  return { publicKey, privateKey };
}

// The methods to get signatures in MetaMask and Truffle are different and return slightly different results.
export async function getMessageSignatureMetamask(
  web3: Web3,
  messageToSign: string,
  signingAccount: string
): Promise<string> {
  // Note: web3 types seem to erroneously assume that a third argument is required, but it is not, so pass undefined and cast to string.
  return await web3.eth.personal.sign(messageToSign, signingAccount, (undefined as unknown) as string);
}

export async function getMessageSignatureTruffle(
  web3: Web3,
  messageToSign: string,
  signingAccount: string
): Promise<string> {
  const signature = await web3.eth.sign(messageToSign, signingAccount);
  // The 65 byte signature consists of r (first 32 bytes), s (next 32 bytes), and v (final byte). 65 bytes is
  // represented as 130 hex digits and the initial "0x". In order to produce a consistent signature with Metamask, we
  // have to adjust the v value.
  const rAndS = signature.substring(0, 128 + 2);
  const v = signature.substring(128 + 2, 132);
  if (v === "00") {
    return rAndS + "1b";
  } else {
    return rAndS + "1c";
  }
}

// The following two methods derive a private key from the signature of a particular message by a particular account.
// Note: this is not meant to be used to generate private keys that hold ETH or any other high value assets. This is
// meant to create a node/metamask friendly way of generating a temporary encryption/decryption key for sending private
// messages.

// Derive a private key, that works *only* on Metamask.
export async function deriveKeyPairFromSignatureMetamask(
  web3: Web3,
  messageToSign: string,
  signingAccount: string
): Promise<KeyPair> {
  return deriveKeyPair(web3, await getMessageSignatureMetamask(web3, messageToSign, signingAccount));
}

// Derive a private key, that works *only* with Truffle.
export async function deriveKeyPairFromSignatureTruffle(
  web3: Web3,
  messageToSign: string,
  signingAccount: string
): Promise<KeyPair> {
  return deriveKeyPair(web3, await getMessageSignatureTruffle(web3, messageToSign, signingAccount));
}

// Signs a message in a way where it can be verified onchain by the openzeppelin ECDSA library.
export async function signMessage(web3: Web3, message: string, account: string): Promise<string> {
  // Must hash the inner message because Solidity requires a fixed length message to verify a signature.
  const innerMessageHash = await web3.utils.soliditySha3(message);
  assert(innerMessageHash, "innerMessageHash is null");

  // Construct a signature that will be accepted by openzeppelin.
  // See https://github.com/OpenZeppelin/openzeppelin-solidity/blob/1e584e495782ebdb5096fe65037d99dae1cbe940/contracts/cryptography/ECDSA.sol#L53
  // and https://medium.com/@yaoshiang/ethereums-ecrecover-openzeppelin-s-ecdsa-and-web3-s-sign-8ff8d16595e1 for details.
  const mutableSignature = await web3.eth.sign(innerMessageHash, account);
  const rs = mutableSignature.slice(0, 128 + 2);
  let v = mutableSignature.slice(128 + 2, 130 + 2);
  if (v == "00") {
    v = "1b";
  } else if (v == "01") {
    v = "1c";
  }
  return rs + v;
}
