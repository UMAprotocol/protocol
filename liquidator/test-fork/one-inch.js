require("../test/mocha.env");

const { toWei } = web3.utils;

const { GasEstimator } = require("@umaprotocol/financial-templates-lib");
const { getLogger } = require("../src/common");
const { OneInchExchange } = require("../src/one-inch");

const { oneInchSwapAndCheck, CONSTANTS } = require("../test/common");

contract("OneInch", function(accounts) {
  const user = accounts[0];

  const { ETH_ADDRESS } = CONSTANTS;
  const DAI_ADDRESS = "0x6b175474e89094c44da98b954eedeac495271d0f";
  const BAT_ADDRESS = "0x0d8775f648430679a709e98d2b0cb6250d2887ef";

  const gasEstimator = new GasEstimator(getLogger());

  const oneInch = new OneInchExchange({ web3, gasEstimator });
  const swapAndCheck = oneInchSwapAndCheck(oneInch);

  it("Swap ETH -> DAI", async function() {
    await swapAndCheck({
      fromToken: ETH_ADDRESS,
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
      toToken: ETH_ADDRESS,
      amountWei: toWei("100"),
      userAddress: user
    });
  });
});
