const Token = artifacts.require("ExpandedERC20");

const assert = require("assert");
const { toWei, toBN } = web3.utils;
const { OneInchExchange } = require("../OneInchExchange");

// Custom winston transport module to monitor winston log outputs
const winston = require("winston");
const sinon = require("sinon");
const { GasEstimator, SpyTransport } = require("@umaprotocol/financial-templates-lib");

const assertBNGreaterThan = (a, b) => {
  const [aBN, bBN] = [a, b].map(x => toBN(x));
  assert.ok(aBN.gt(bBN), `${aBN.toString()} is not greater than ${bBN.toString()}`);
};

contract("OneInch", function(accounts) {
  const user = accounts[0];

  const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const DAI_ADDRESS = "0x6b175474e89094c44da98b954eedeac495271d0f";
  const BAT_ADDRESS = "0x0d8775f648430679a709e98d2b0cb6250d2887ef";

  const spy = sinon.spy();

  const spyLogger = winston.createLogger({
    level: "info",
    transports: [new SpyTransport({ level: "info" }, { spy: spy })]
  });

  const gasEstimator = new GasEstimator(spyLogger);

  const oneInch = new OneInchExchange({ web3, gasEstimator });

  const getBalance = async ({ tokenAddress, userAddress }) => {
    if (tokenAddress === ETH_ADDRESS) {
      return web3.eth.getBalance(userAddress);
    }

    const erc20 = await Token.at(tokenAddress);
    return erc20.balanceOf.call(userAddress);
  };

  const swapAndCheck = async ({ fromToken, toToken, amountWei }) => {
    const initialBal = await getBalance({ tokenAddress: toToken, userAddress: user });

    await oneInch.swap(
      {
        fromToken,
        toToken,
        amountWei
      },
      fromToken === ETH_ADDRESS ? { value: amountWei, from: user } : { from: user }
    );

    const finalBal = await getBalance({ tokenAddress: toToken, userAddress: user });

    assertBNGreaterThan(finalBal, initialBal);
  };

  it("Swap ETH -> DAI", async () => {
    await swapAndCheck({
      fromToken: ETH_ADDRESS,
      toToken: DAI_ADDRESS,
      amountWei: toWei("5")
    });
  });

  it("Swap DAI -> BAT", async () => {
    await swapAndCheck({
      fromToken: DAI_ADDRESS,
      toToken: BAT_ADDRESS,
      amountWei: toWei("10")
    });
  });

  it("Swap DAI -> ETH", async () => {
    await swapAndCheck({
      fromToken: DAI_ADDRESS,
      toToken: ETH_ADDRESS,
      amountWei: toWei("100")
    });
  });
});
