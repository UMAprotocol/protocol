/**
 * @notice Gets the contract abi. This method will automatically be exported instead of getAbi() in the case that
 * this is being used in a truffle test context.
 * @param {String} contractName Name of the UMA contract whose abi is to be retrieved.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
declare function getAbiTest(contractName: string, version?: string): any;
/**
 * @notice Gets the contract address. This method will automatically be exported instead of getAdress in the case that
 * this is being used in a truffle test context.
 * @param {String} contractName Name of the UMA contract whose address is to be retrieved.
 * @param {Integer} networkId  Network ID of the network where that contract is deployed.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
declare function getAddressTest(contractName: string, networkId: any, version?: string): any;
/**
 * @notice Creates a new truffle contract instance using artifacts. This method will automatically be exported instead
 * of the above method in the case that this is being used in a truffle test context.
 * @param {String} contractName Name of the UMA contract to be instantiated.
 * @param {Object} [web3] web3 object, only used in the case that version != latest.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
declare function getTruffleContractTest(contractName: string, web3?: any, version?: string): any;
/**
 * @notice Gets the abi for an UMA contract.
 * @param {String} contractName Name of the UMA contract whose abi will be returned.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
export function getAbi(contractName: string, version?: string): any;
/**
 * @notice Gets the deployed address for an UMA contract.
 * @param {String} contractName Name of the UMA contract whose address will be returned.
 * @param {Integer} networkId Network ID of the network where that contract is deployed.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
export function getAddress(contractName: string, networkId: any, version?: string): any;
/**
 * @notice Creates a new truffle contract instance based on an existing web3 instance (using its provider).
 * If a web3 instance is not provided, this function will use getWeb3() to attempt to create one.
 * @param {String} contractName Name of the UMA contract to be instantiated.
 * @param {Object} [web3] Custom web3 instance whose provider should be injected into the truffle contract.
 * @param {String} [version] version identifier x.y.z for the contract. Defaults to "latest".
 */
export function getTruffleContract(contractName: string, web3?: any, version?: string): any;
export { getAbiTest as getAbi, getAddressTest as getAddress, getTruffleContractTest as getTruffleContract };
