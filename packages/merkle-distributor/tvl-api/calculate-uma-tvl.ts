const nodeFetch = require("node-fetch");

const { getAbi, getAddress } = require("@uma/core");
const { getWeb3, ConvertDecimals } = require("@uma/common");
const web3 = getWeb3();
const { toWei, toBN, fromWei } = web3.utils;

const fixedPointAdjustment = toBN(toWei("1"));

export async function calculateCurrentTvl() {
  const allFinancialContractsData = await fetchAllFinancialContractsData();
  const collateralInfoWithValue = await evaluateFinancialContractCollateral(allFinancialContractsData);
  const currentTvl = collateralInfoWithValue
    .reduce((accumulator: typeof web3.BN, obj: any) => {
      return accumulator.add(toBN(toWei(obj.collateralValueInUsd)));
    }, toBN("0"))
    .div(fixedPointAdjustment)
    .toString();

  return { currentTvl, currentTime: Math.round(new Date().getTime() / 1000) };
}

export async function fetchAllFinancialContractsData() {
  const registeredContracts: Array<string> = await fetchAllRegisteredContracts();
  const collateralAddresses: Array<string> = await fetchCollateralForFinancialContracts(registeredContracts);
  const { collateralBalances, collateralDecimals, collateralPricesInUsd } = await fetchCollateralInfo(
    collateralAddresses,
    registeredContracts
  );

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

export async function evaluateFinancialContractCollateral(
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

export async function fetchCollateralInfo(collateralAddresses: Array<string>, registeredContracts: Array<string>) {
  const [collateralBalances, collateralDecimals, collateralPricesInUsd] = await Promise.all([
    fetchCollateralBalances(collateralAddresses, registeredContracts),
    fetchCollateralDecimals(collateralAddresses),
    fetchCollateralValue(collateralAddresses)
  ]);

  return { collateralBalances, collateralDecimals, collateralPricesInUsd };
}

export async function fetchAllRegisteredContracts() {
  const mainnetRegistry = new web3.eth.Contract(getAbi("Registry"), getAddress("Registry", 1));
  const events = await mainnetRegistry.getPastEvents("NewContractRegistered", { fromBlock: 0, toBlock: "latest" });
  return events.map((event: any) => event.returnValues.contractAddress);
}

export async function fetchCollateralForFinancialContracts(financialContractAddresses: Array<string>) {
  const contractInstances = financialContractAddresses.map(
    (address: string) => new web3.eth.Contract(getAbi("FeePayer"), address)
  );

  const collateralAddresses = await Promise.allSettled(
    contractInstances.map(contractInstance => contractInstance.methods.collateralCurrency().call())
  );

  return collateralAddresses.map((response: any) =>
    response.status === "fulfilled" ? response.value.toLowerCase() : null
  );
}

export async function fetchCollateralDecimals(collateralTokenAddresses: Array<string>) {
  const contractInstances = collateralTokenAddresses.map((address: string) =>
    address ? new web3.eth.Contract(getAbi("ExpandedERC20"), address) : null
  );

  const collateralDecimals = await Promise.allSettled(
    contractInstances.map(contractInstance => (contractInstance ? contractInstance.methods.decimals().call() : null))
  );

  return collateralDecimals.map((response: any) => (response.status === "fulfilled" ? response.value : null));
}

export async function fetchCollateralBalances(
  collateralTokenAddresses: Array<string>,
  financialContractAddresses: Array<string>
) {
  const contractInstances = collateralTokenAddresses.map((address: string) =>
    address ? new web3.eth.Contract(getAbi("ExpandedERC20"), address) : null
  );

  const collateralDecimals = await Promise.allSettled(
    contractInstances.map((contractInstance: any, index: number) =>
      contractInstance ? contractInstance.methods.balanceOf(financialContractAddresses[index]).call() : null
    )
  );

  return collateralDecimals.map((response: any) => (response.status === "fulfilled" ? response.value : null));
}

export async function fetchCollateralValue(collateralTokenAddresses: Array<string>) {
  const hostApi = "https://api.coingecko.com/api/v3/simple/token_price/ethereum";
  const currency = "usd";
  const tokenAddressArray = [...new Set(collateralTokenAddresses.filter(n => n))].join("%2C");

  const response = await nodeFetch(`${hostApi}?contract_addresses=${tokenAddressArray}&vs_currencies=${currency}`);
  const prices = await response.json();

  return collateralTokenAddresses.map((address: string) =>
    address && prices[address] ? prices[address].usd.toString() : null
  );
}

calculateCurrentTvl()
  .then(v => {
    console.log("RETURN", v);
    process.exit(0);
  })
  .catch(e => {
    console.log(e);
    process.exit(1);
  });
