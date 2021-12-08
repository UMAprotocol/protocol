async function main() {
  const winston = require("winston");

  const { getWeb3 } = require("@uma/common");
  const web3 = getWeb3();

  const { getAbi, getAddress } = require("@uma/contracts-node");
  const { GasEstimator } = require("@uma/financial-templates-lib");

  const [accounts, networkId] = await Promise.all([web3.eth.getAccounts(), web3.eth.net.getId()]);
  console.log(`Running Bridge Pool Sync script on ${accounts[0]}, networkId ${networkId} 🏊‍♂️`);

  const bridgeAdmin = new web3.eth.Contract(getAbi("BridgeAdminInterface"), await getAddress("BridgeAdmin", networkId));
  const tokenWhitelistedEvents = await bridgeAdmin.getPastEvents("WhitelistToken", { fromBlock: 0 });
  const poolAddresses = [...new Set(tokenWhitelistedEvents.map((event: any) => event.returnValues.bridgePool))];
  console.log(`total of ${poolAddresses.length} unique pools will be sync`);

  const syncTxData = [];
  for (const poolAddress of poolAddresses) {
    const bridgePool = new web3.eth.Contract(getAbi("BridgePool"), poolAddress);
    syncTxData.push({ target: poolAddress, callData: bridgePool.methods.syncUmaEcosystemParams().encodeABI() });
    syncTxData.push({ target: poolAddress, callData: bridgePool.methods.syncWithBridgeAdminParams().encodeABI() });
  }

  const multicall = new web3.eth.Contract(getAbi("Multicall2"), "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696");

  console.log("Sending sync transaction...");
  const logger = winston.createLogger({ level: "debug", transports: [new winston.transports.Console()] });
  const gasEstimator = new GasEstimator(logger);
  await gasEstimator.update();
  const tx = await multicall.methods
    .aggregate(syncTxData)
    .send({ from: accounts[0], ...gasEstimator.getCurrentFastPrice() });
  console.log(`Sent sync tx: https://etherscan.io/tx/${tx.transactionHash}`);
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error.stack);
    process.exit(1);
  }
);
