const { getAbi } = require("@uma/contracts-node");
const { getWeb3, runTransaction } = require("@uma/common");
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");

const web3 = getWeb3();

async function run() {
  console.log("running on", web3.version);

  const accounts = await web3.eth.getAccounts();
  console.log({ accounts });

  const tkn = new web3.eth.Contract(getAbi("TestnetERC20"), "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2");

  const gasEstimator = new GasEstimator(
    winston.createLogger({ level: "debug", transports: [new winston.transports.Console()] }),
    60, // Time between updates.
    1
  );
  await gasEstimator.update();
  console.log("PRICE", { ...gasEstimator.getCurrentFastPrice() });

  console.log("CALLING RUNNER");
  const output1 = await runTransaction({
    web3: web3,
    transaction: tkn.methods.approve("0xe101B874431B5dc96f6d19fC1DE16eAD922D639b", 100),
    transactionConfig: { ...gasEstimator.getCurrentFastPrice(), from: accounts[0] },
    availableAccounts: 1,
    waitForMine: false,
  });

  console.log("output1", output1);

  const output2 = await runTransaction({
    web3: web3,
    transaction: tkn.methods.approve("0x85b4a1b53656528cfe76100d61d6b3316ba6aa2e", 100),
    transactionConfig: { ...gasEstimator.getCurrentFastPrice(), from: accounts[0] },
    availableAccounts: 1,
    waitForMine: false,
  });

  console.log("output2", output2);

  const output3 = await runTransaction({
    web3: web3,
    transaction: tkn.methods.approve("0x9a8f92a830a5cb89a3816e3d267cb7791c16b04d", 100),
    transactionConfig: { ...gasEstimator.getCurrentFastPrice(), from: accounts[0] },
    availableAccounts: 1,
    waitForMine: false,
  });

  console.log("output3", output3);

  // await web3.eth.sendTransaction(
  //   {
  //     from: accounts[0],
  //     to: tkn.options.address,
  //     type: "0x2",
  //     ...gasEstimator.getCurrentFastPrice(),
  //     data: tkn.methods.approve("0xe101B874431B5dc96f6d19fC1DE16eAD922D639b", 100).encodeABI(),
  //   },
  //   function (error, hash) {
  //     console.log("error", error);
  //     console.log("hash", hash);
  //   }
  // );
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
