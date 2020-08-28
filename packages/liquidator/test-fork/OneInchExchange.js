const { toWei } = web3.utils;

const { GasEstimator, SpyTransport } = require("@umaprotocol/financial-templates-lib");
const { OneInchExchange } = require("../src/OneInchExchange");

const { oneInchSwapAndCheck, CONSTANTS } = require("../test/common");

const sinon = require("sinon");
const winston = require("winston");

contract("OneInch", function(accounts) {
  const user = accounts[0];

  const { ALTERNATIVE_ETH_ADDRESS } = CONSTANTS;
  const DAI_ADDRESS = "0x6b175474e89094c44da98b954eedeac495271d0f";
  const BAT_ADDRESS = "0x0d8775f648430679a709e98d2b0cb6250d2887ef";

  const spy = sinon.spy(); // Create a new spy for each test.
  const spyLogger = winston.createLogger({
    level: "info",
    transports: [new SpyTransport({ level: "info" }, { spy: spy })]
  });

  const gasEstimator = new GasEstimator(spyLogger);

  const oneInch = new OneInchExchange({ web3, logger: spyLogger, gasEstimator });
  const swapAndCheck = oneInchSwapAndCheck(oneInch);

  it("Swap ETH -> DAI", async function() {
    await swapAndCheck({
      fromToken: ALTERNATIVE_ETH_ADDRESS,
      toToken: DAI_ADDRESS,
      amountWei: toWei("5"),
      userAddress: user
    });
  });

  it("Swap DAI -> BAT", async function() {
    await swapAndCheck({
      fromToken: DAI_ADDRESS,
      toToken: BAT_ADDRESS,
      amountWei: toWei("10"),
      userAddress: user
    });
  });

  it("Swap DAI -> ETH", async function() {
    await swapAndCheck({
      fromToken: DAI_ADDRESS,
      toToken: ALTERNATIVE_ETH_ADDRESS,
      amountWei: toWei("100"),
      userAddress: user
    });
  });
});
