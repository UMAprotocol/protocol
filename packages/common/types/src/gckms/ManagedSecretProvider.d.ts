export class ManagedSecretProvider {
    constructor(cloudKmsSecretConfigs: any, ...remainingArgs: any[]);
    cloudKmsSecretConfigs: any;
    remainingArgs: any[];
    wrappedProvider: HDWalletProvider;
    wrappedProviderPromise: Promise<HDWalletProvider>;
    constructWrappedProvider(): Promise<HDWalletProvider>;
    sendAsync(...all: any[]): void;
    send(...all: any[]): void;
    getAddress(...all: any[]): string;
    getWrappedProviderOrThrow(): HDWalletProvider;
    getOrConstructWrappedProvider(): Promise<HDWalletProvider>;
}
import HDWalletProvider = require("@truffle/hdwallet-provider");
