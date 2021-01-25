export function encryptMessage(publicKey: any, message: any): Promise<string>;
export function addressFromPublicKey(publicKey: any): string;
export function decryptMessage(privKey: any, encryptedMessage: any): Promise<string>;
export function recoverPublicKey(privateKey: any): string;
export function deriveKeyPairFromSignatureTruffle(web3: any, messageToSign: any, signingAccount: any): Promise<{
    publicKey: string;
    privateKey: any;
}>;
export function deriveKeyPairFromSignatureMetamask(web3: any, messageToSign: any, signingAccount: any): Promise<{
    publicKey: string;
    privateKey: any;
}>;
export function getMessageSignatureTruffle(web3: any, messageToSign: any, signingAccount: any): Promise<string>;
export function getMessageSignatureMetamask(web3: any, messageToSign: any, signingAccount: any): Promise<any>;
export function signMessage(web3: any, message: any, account: any): Promise<any>;
