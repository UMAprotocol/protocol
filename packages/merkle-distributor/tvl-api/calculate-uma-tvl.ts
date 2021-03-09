const nodeFetch = require("node-fetch");

const { getAbi, getAddress } = require("@uma/core");
const { getWeb3 } = require("@uma/common");
const web3 = getWeb3();

const mainnetRegistry = new web3.eth.Contract(getAbi("Registry"), getAddress("Registry", 1));
console.log("zz", getAddress("Registry", 1));

export async function calculateLatestTvl() {
  console.log("running");
  const registeredContracts = await fetchAllRegisteredContracts();
  console.log("registeredContracts", registeredContracts);
  const collateralAddresses = await fetchCollateralForFinancialContracts(registeredContracts);

  const [balances, decimals, prices] = await Promise.all([
    fetchCollateralBalances(collateralAddresses, registeredContracts),
    fetchCollateralDecimals(collateralAddresses),
    fetchCollateralValue(collateralAddresses)
  ]);
  console.log("collateralAddresses", collateralAddresses);
  console.log("balances", balances);
  console.log("decimals", decimals);
  console.log("prices", prices);

  const fullDataStructure = registeredContracts
    .map((contractAddress: string, index: number) => {
      return { contractAddress, balance: balances[index], decimal: decimals[index], price: prices[index] };
    })
    .filter((financialContractObject: any) => financialContractObject.balance);
  console.log("fullDataStructure", fullDataStructure);
}

export async function fetchAllRegisteredContracts() {
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

export async function fetchCollateralValue(collateralTokenAddress: Array<string>) {
  const hostApi = "https://api.coingecko.com/api/v3/simple/token_price/ethereum";
  const currency = "usd";
  const tokenAddressArray = [...new Set(collateralTokenAddress.filter(n => n))].join("%2C");

  const response = await nodeFetch(`${hostApi}?contract_addresses=${tokenAddressArray}&vs_currencies=${currency}`);
  const prices = await response.json();

  return collateralTokenAddress.map((address: any) => (address && prices[address] ? prices[address].usd : null));
}

// export async function calculateTvl(collateralBalances, collateralDecimals, collateralPrices) {}

calculateLatestTvl()
  .then(v => {
    process.exit(0);
  })
  .catch(e => {
    console.log(e);
    process.exit(1);
  });
