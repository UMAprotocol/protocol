// TODO: the location of these scripts is a bit confusing. This script was put here to follow the Redeem and Withdraw
// scripts but in future they should be moved somewhere more generic.

// This script enables a DSProxy to settle expired positions from an EMP. This should be used after a DSProxy opens a
// position due to liquidation and needs to settle the position at contract expiration. To execute the script, run:
// truffle exec ./scripts/SettleExpiredPositionWithDSProxy.ts --financialContractAddress 0x123 --dsProxyAddress 0x456 --network mainnet_mnemonic
// Note: if you do not provide the dsProxyAddress the script will try find one deployed at the unlocked wallet account.

async function SettleExpiredPositionWithDSProxy() {
  const winston = require("winston");
  const assert = require("assert");
  const argv = require("minimist")(process.argv.slice(), {
    string: ["financialContractAddress", "numTokens", "dsProxyAddress"],
  });

  const { getWeb3 } = require("@uma/common");
  const web3 = getWeb3();

  const { getAbi, getAddress, getTruffleContract } = require("@uma/core");
  const { DSProxyManager, GasEstimator } = require("@uma/financial-templates-lib");

  assert(web3.utils.isAddress(argv.financialContractAddress), "`financialContractAddress` needs to be a valid address");
  console.log("Running position settler script 💰");

  const [accounts, networkId] = await Promise.all([web3.eth.getAccounts(), web3.eth.net.getId()]);
  console.log("Connected to network id", await web3.eth.net.getId());

  const logger = winston.createLogger({
    level: "debug",
    transports: [new winston.transports.Console()],
  });
  const gasEstimator = new GasEstimator(logger);
  await gasEstimator.update();

  const dsProxyManager = new DSProxyManager({
    logger,
    web3,
    gasEstimator,
    account: accounts[0],
    dsProxyFactoryAddress: getAddress("DSProxyFactory", networkId),
    dsProxyFactoryAbi: getAbi("DSProxyFactory"),
    dsProxyAbi: getAbi("DSProxy"),
  });

  // Load in a DSProxy address. If you did not provide one in the args then the script will check against the factory.
  // False as the second param in this function prevents the DSProxyManager from deploying a DSProxy if you don't have one.
  await dsProxyManager.initializeDSProxy(argv.dsProxyAddress || null, false);

  const dsProxyAddress = dsProxyManager.getDSProxyAddress();
  if (!dsProxyAddress) throw new Error("DSProxy Address was not found or not parameterized");

  // Create the callData as the encoded tx against the PositionSettler contract.
  const PositionSettler = getTruffleContract("PositionSettler", web3);
  const PositionSettlerInstance = new web3.eth.Contract(PositionSettler.abi);
  const callData = PositionSettlerInstance.methods.settle(argv.financialContractAddress).encodeABI();

  // The library also needs the code of the contract to deploy.
  const callCode = PositionSettler.bytecode;

  // Send the transaction against the DSProxy manager.
  const dsProxyCallReturn = await dsProxyManager.callFunctionOnNewlyDeployedLibrary(callCode, callData);

  console.log("TX executed!", dsProxyCallReturn.transactionHash);
}

const run = async function (callback) {
  try {
    await SettleExpiredPositionWithDSProxy();
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

run.SettleExpiredPositionWithDSProxy = SettleExpiredPositionWithDSProxy;
module.exports = run;
