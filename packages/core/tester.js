const { getAbi } = require("@uma/contracts-node");
const { getWeb3, runTransaction } = require("@uma/common");
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");

const web3 = getWeb3();

async function run() {
  console.log("running on", web3.version);

  const accounts = await web3.eth.getAccounts();
  console.log({ accounts });

  const tkn = new web3.eth.Contract(getAbi("TestnetERC20"), "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");

  const gasEstimator = new GasEstimator(
    winston.createLogger({ level: "debug", transports: [new winston.transports.Console()] }),
    60, // Time between updates.
    1
  );
  await gasEstimator.update();
  console.log("PRICE", { ...gasEstimator.getCurrentFastPrice() });

  console.log("CALLING RUNNER");

  for (let i = 0; i < 5; i++) {
    const output1 = await runTransaction({
      web3: web3,
      transaction: tkn.methods.approve("0xe101B874431B5dc96f6d19fC1DE16eAD922D639b", 100),
      transactionConfig: { ...gasEstimator.getCurrentFastPrice(), from: accounts[0] },
      availableAccounts: 1,
      waitForMine: false,
    });

    console.log("hash", output1.receipt.transactionHash);
  }
}

function main() {
  const startTime = Date.now();
  run()
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      const timeElapsed = Date.now() - startTime;
      console.log(`Done in ${(timeElapsed / 1000).toFixed(2)}s`);
      process.exit(1);
    });
}
main();
