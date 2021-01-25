export function enableControllableTiming(network: any): boolean;
export function deploy(deployer: any, network: any, contractType: any, ...args: any[]): Promise<{
    contract: any;
    didDeploy: any;
}>;
export function setToExistingAddress(network: any, contractType: any, address: any): Promise<any>;
export function getKeysForNetwork(network: any, accounts: any): {
    deployer: any;
    registry: any;
    store: any;
    priceFeed: any;
    sponsorWhitelist: any;
    returnCalculatorWhitelist: any;
    marginCurrencyWhitelist: any;
};
export function addToTdr(instance: any, network: any): Promise<void>;
export function isPublicNetwork(network: any): boolean;
