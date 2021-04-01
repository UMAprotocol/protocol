// This script enables a DSProxy to redeem tokens from a contract. This should be used after a swap/mint/liquidate transaction
// to close out a bots position. To execute the script, run:
// truffle exec./ scripts / RedeemTokensWithDSProxy.ts--financialContractAddress 0x123 --numTokens 100000000000000000000 --dsProxyFactoryAddress 0x123 --network mainnet_mnemonic
// Note if you do not provide the dsProxyAddress the script will try find one deployed at the unlocked wallet account.

async function RedeemTokensWithDSProxy() {
  const winston = require("winston");
  const assert = require("assert");
  const argv = require("minimist")(process.argv.slice(), {
    string: ["financialContractAddress", "numTokens", "dsProxyAddress", "dsProxyFactoryAddress"]
  });

  const { getWeb3 } = require("@uma/common");
  const web3 = getWeb3();

  const { getAbi, getAddress, getTruffleContract } = require("@uma/core");
  const { DSProxyManager, GasEstimator } = require("@uma/financial-templates-lib");

  assert(argv.numTokens, "Must provide the number of tokens to redeem");

  assert(web3.utils.isAddress(argv.financialContractAddress), "`financialContractAddress` needs to be a valid address");
  console.log("Running Token withdrawal script 💰");

  const [accounts, networkId] = await Promise.all([web3.eth.getAccounts(), web3.eth.net.getId()]);
  console.log("Connected to network id", await web3.eth.net.getId());

  const logger = winston.createLogger({
    level: "debug",
    transports: [new winston.transports.Console()]
  });
  const gasEstimator = new GasEstimator(logger);
  await gasEstimator.update();

  const dsProxyManager = new DSProxyManager({
    logger,
    web3,
    gasEstimator,
    account: accounts[0],
    dsProxyFactoryAddress: argv.dsProxyFactoryAddress || getAddress("DSProxyFactory", networkId),
    dsProxyFactoryAbi: getAbi("DSProxyFactory"),
    dsProxyAbi: getAbi("DSProxy")
  });

  // Load in a DSProxy address. If you did not provide one in the args then the script will check against the factory.
  // False as the second param in this function prevents the DSProxyManager from deploying a DSProxy if you don't have one.
  await dsProxyManager.initializeDSProxy(argv.dsProxyAddress, false);

  const dsProxyAddress = dsProxyManager.getDSProxyAddress();
  if (!dsProxyAddress) throw new Error("DSProxy Address was not found or parameterized");

  // Create the callData as the encoded tx against the TokenRedeemer contract.
  const TokenRedeemer = getTruffleContract("TokenRedeemer", web3);
  const TokenRedeemerInstance = new web3.eth.Contract(TokenRedeemer.abi);
  const callData = TokenRedeemerInstance.methods
    .redeem(argv.financialContractAddress, { rawValue: argv.numTokens })
    .encodeABI();

  // The library also needs the code of the contract to deploy.
  const callCode = TokenRedeemer.bytecode;

  // Send the transaction against the DSProxy manager.
  const dsProxyCallReturn = await dsProxyManager.callFunctionOnNewlyDeployedLibrary(callCode, callData);

  console.log("TX executed!", dsProxyCallReturn.transactionHash);
}

const run = async function(callback) {
  try {
    await RedeemTokensWithDSProxy();
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

run.RedeemTokensWithDSProxy = RedeemTokensWithDSProxy;
module.exports = run;
