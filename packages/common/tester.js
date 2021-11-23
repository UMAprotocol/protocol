const { getAbi } = require("@uma/contracts-node");
const { getWeb3, runTransaction, processTransactionPromisesBatch } = require("@uma/common");
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");

const web3 = getWeb3();

async function run() {
  console.log("running on", web3.version);

  const accounts = await web3.eth.getAccounts();
  console.log({ accounts });

  let tkn = new web3.eth.Contract(getAbi("TestnetERC20"), "0x12AD8eF0Eb3DBEB28EFa51Db00C93f6AeCf0CBcc");

  const logger = winston.createLogger({ level: "debug", transports: [new winston.transports.Console()] });
  const gasEstimator = new GasEstimator(logger, 60, 1);
  await gasEstimator.update();
  console.log("PRICE", { ...gasEstimator.getCurrentFastPrice() });

  console.log("CALLING RUNNER");

  let promiseArray = [];

  for (let i = 0; i < 5; i++) {
    const output1 = await runTransaction({
      web3: web3,
      transaction: tkn.methods.approve("0xe101B874431B5dc96f6d19fC1DE16eAD922D639b", 100),
      transactionConfig: { ...gasEstimator.getCurrentFastPrice(), from: accounts[0] },
      availableAccounts: 1,
      waitForMine: false,
    });

    console.log("output", output1.transactionHash);
    promiseArray.push(output1);
  }

  console.log("END LOOP. promise count:", promiseArray.length, "waiting...");

  await processTransactionPromisesBatch(promiseArray, logger);
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
