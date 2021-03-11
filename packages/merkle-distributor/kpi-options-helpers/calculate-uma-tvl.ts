import nodeFetch from "node-fetch";

import { getAbi, getAddress } from "@uma/core";
import { getWeb3, ConvertDecimals } from "@uma/common";
const web3 = getWeb3();
const { toWei, toBN, fromWei } = web3.utils;

const fixedPointAdjustment = toBN(toWei("1"));

// Returns the current UMA TVL over all functions as a string and the currentTime.
export async function calculateCurrentTvl() {
  const allFinancialContractsData = await getAllFinancialContractsData();
  const collateralInfoWithValue = await evaluateFinancialContractCollateral(allFinancialContractsData);
  const currentTvl = collateralInfoWithValue
    .reduce((accumulator: typeof web3.BN, obj: any) => {
      return accumulator.add(toBN(toWei(obj.collateralValueInUsd)));
    }, toBN("0"))
    .div(fixedPointAdjustment)
    .toString();
  return { currentTvl, currentTime: Math.round(new Date().getTime() / 1000) };
}

// Fetches information on all financial contracts.
export async function getAllFinancialContractsData() {
  const registeredContracts: Array<string> = await getAllRegisteredContracts();
  const collateralAddresses: Array<string> = await getCollateralForFinancialContracts(registeredContracts);
  const { collateralBalances, collateralDecimals, collateralPricesInUsd } = await getCollateralInfo(
    collateralAddresses,
    registeredContracts
  );

  // Append original data to the structure and filter out contracts that dont have a balance (null). These are contracts
  // that are in the Registry but dont implement the `collateralCurrency` public method, such as the optimistic oracle.
  return registeredContracts
    .map((contractAddress: string, index: number) => {
      return {
        contractAddress,
        collateralAddress: collateralAddresses[index],
        collateralBalance: collateralBalances[index],
        collateralDecimal: collateralDecimals[index],
        collateralPriceInUsd: collateralPricesInUsd[index]
      };
    })
    .filter((financialContractObject: any) => financialContractObject.collateralBalance);
}
// For an array of financialContractData objects, append the value of the collateral in USD using the balance and price.
export function evaluateFinancialContractCollateral(
  collateralObjects: Array<{
    contractAddress: string;
    collateralAddress: string;
    collateralBalance: string;
    collateralDecimal: string;
    collateralPriceInUsd: string;
  }>
) {
  return collateralObjects.map((obj: any) => {
    const collateralBalanceNormalized = ConvertDecimals(obj.collateralDecimal, 18, web3)(obj.collateralBalance);
    const priceNormalized = toBN(toWei(obj.collateralPriceInUsd));
    const collateralValue = collateralBalanceNormalized.mul(priceNormalized).div(fixedPointAdjustment);

    return { ...obj, collateralValueInUsd: fromWei(collateralValue) };
  });
}

// For an array of collateral types associated with an array of financial contracts, compute the balance in collateral
// of the financial contract, the collateral decimals and the value In USD of each unit of collateral.
export async function getCollateralInfo(collateralAddresses: Array<string>, registeredContracts: Array<string>) {
  const [collateralBalances, collateralDecimals, collateralPricesInUsd] = await Promise.all([
    getTokenBalances(collateralAddresses, registeredContracts),
    getContractDecimals(collateralAddresses),
    getContractPrices(collateralAddresses)
  ]);

  return { collateralBalances, collateralDecimals, collateralPricesInUsd };
}

// Return an array of all registered contracts found in the Registry. Note that some non-financial contracts are included
// in this list, such as the Optimistic oracle. These will have `null` values for their collateral type, balance and price.
// They are filtered out later on in the `getAllFinancialContractsData` method.
export async function getAllRegisteredContracts() {
  const mainnetRegistry = new web3.eth.Contract(getAbi("Registry"), getAddress("Registry", 1));
  const events = await mainnetRegistry.getPastEvents("NewContractRegistered", { fromBlock: 0, toBlock: "latest" });
  return events.map((event: any) => event.returnValues.contractAddress);
}

// Returns an array of collateral types for an array of financial contract addresses. Note that `FeePayer` is the simplest
// ABI implementation that provides the `collateralCurrency` public method.
export async function getCollateralForFinancialContracts(financialContractAddresses: Array<string>) {
  const contractInstances = financialContractAddresses.map(
    (address: string) => new web3.eth.Contract(getAbi("FeePayer"), address)
  );

  // We use allSettled as some of the async calls might fail. In particular, if the method does not implement the public
  // method collateralCurrency they will fail.
  const collateralAddresses = await Promise.allSettled(
    contractInstances.map(contractInstance => contractInstance.methods.collateralCurrency().call())
  );

  // If the contract does not have the method called then return null.
  return collateralAddresses.map((response: any) =>
    response.status === "fulfilled" ? response.value.toLowerCase() : null
  );
}

// Returns an array of decimals associated with an array of token addresses. Note if any contract is not implemented
// (null) or the decimals method is not implemented this will return null for that collateral token.
export async function getContractDecimals(ContractAddresses: Array<string>) {
  const contractInstances = ContractAddresses.map((address: string) =>
    address ? new web3.eth.Contract(getAbi("ExpandedERC20"), address) : null
  );

  const collateralDecimals = await Promise.allSettled(
    contractInstances.map(contractInstance => (contractInstance ? contractInstance.methods.decimals().call() : null))
  );
  return collateralDecimals.map((response: any) => (response.status === "fulfilled" ? response.value : null));
}

// Returns an array of balances associated with an array of token addresses and financial contract addresses. Note
// if any contract is not implemented (null) null for that collateral token.
export async function getTokenBalances(ContractAddresses: Array<string>, financialContractAddresses: Array<string>) {
  const contractInstances = ContractAddresses.map((address: string) =>
    address ? new web3.eth.Contract(getAbi("ExpandedERC20"), address) : null
  );

  const collateralDecimals = await Promise.allSettled(
    contractInstances.map((contractInstance: any, index: number) =>
      contractInstance ? contractInstance.methods.balanceOf(financialContractAddresses[index]).call() : null
    )
  );

  return collateralDecimals.map((response: any) => (response.status === "fulfilled" ? response.value : null));
}

// Return an array of spot prices for an array of collateral addresses in one async call. Note we might in future
// want to change this to re-use the bot's price feeds for more complex collateral types like LP tokens.
export async function getContractPrices(ContractAddresses: Array<string>, currency = "usd") {
  const hostApi = "https://api.coingecko.com/api/v3/simple/token_price/ethereum";

  // Generate a unique set with no repeated. join the set with the required coingecko delimiter.
  const tokenAddressArray = [...new Set(ContractAddresses.filter(n => n))].join("%2C");

  const response = await nodeFetch(`${hostApi}?contract_addresses=${tokenAddressArray}&vs_currencies=${currency}`);
  const prices = await response.json();

  // Map the returned values back to all provided ContractAddresses.
  return ContractAddresses.map((address: string) =>
    address && prices[address] ? prices[address].usd.toString() : null
  );
}
