const { getAbi } = require("@uma/contracts-node");
const { getWeb3, runTransaction } = require("@uma/common");
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");

const web3 = getWeb3();

async function run() {
  console.log("running on", web3.version);

  const accounts = await web3.eth.getAccounts();
  console.log({ accounts });

  const tkn = new web3.eth.Contract(getAbi("TestnetERC20"), "0xbF7A7169562078c96f0eC1A8aFD6aE50f12e5A99");

  const gasEstimator = new GasEstimator(
    winston.createLogger({ level: "debug", transports: [new winston.transports.Console()] }),
    60, // Time between updates.
    1
  );
  await gasEstimator.update();
  console.log("PRICE", { ...gasEstimator.getCurrentFastPrice() });

  //   const { receipt } = await runTransaction({
  //     web3: web3,
  //     transaction: tkn.methods.approve("0xe101B874431B5dc96f6d19fC1DE16eAD922D639b", 100),
  //     transactionConfig: { ...gasEstimator.getCurrentFastPrice(), from: accounts[0] },
  //     availableAccounts: 1,
  //   });

  const receipt = tkn.methods
    .approve("0xe101B874431B5dc96f6d19fC1DE16eAD922D639b", 100)
    .send({ ...gasEstimator.getCurrentFastPrice(), from: accounts[0], type: "0x2" });

  console.log("receipt", receipt);
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
