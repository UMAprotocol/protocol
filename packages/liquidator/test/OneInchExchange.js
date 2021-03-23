const OneSplitMock = artifacts.require("OneSplitMock");
const Token = artifacts.require("ExpandedERC20");

const { toWei } = web3.utils;

const { ALTERNATIVE_ETH_ADDRESS } = require("../src/constants");
const { GasEstimator, SpyTransport } = require("@uma/financial-templates-lib");
const { OneInchExchange } = require("../src/OneInchExchange");

const { oneInchSwapAndCheck } = require("./common");

const sinon = require("sinon");
const winston = require("winston");

contract("OneInch", function(accounts) {
  const owner = accounts[0];
  const user = accounts[1];

  const spy = sinon.spy(); // Create a new spy for each test.
  const spyLogger = winston.createLogger({
    level: "info",
    transports: [new SpyTransport({ level: "info" }, { spy: spy })]
  });

  const gasEstimator = new GasEstimator(spyLogger);

  let oneSplitMock;
  let oneInch;
  let token1;
  let token2;

  let swapAndCheck;

  before(async function() {
    oneSplitMock = await OneSplitMock.new();
    oneInch = new OneInchExchange({
      web3,
      gasEstimator,
      logger: spyLogger,
      oneSplitAbi: OneSplitMock.abi,
      erc20TokenAbi: Token.abi,
      oneSplitAddress: oneSplitMock.address
    });

    token1 = await Token.new("TOKEN1", "TK1", 18, { from: owner });
    await token1.addMember(1, owner, { from: owner });

    token2 = await Token.new("TOKEN2", "TK2", 18, { from: owner });
    await token2.addMember(1, owner, { from: owner });

    // Supply exchange with tokens
    await token1.mint(oneSplitMock.address, toWei("100"), { from: owner });
    await token2.mint(oneSplitMock.address, toWei("100"), { from: owner });
    await web3.eth.sendTransaction({
      from: owner,
      to: oneSplitMock.address,
      value: toWei("1")
    });

    // Set prices
    // 1 <-> 1
    await oneSplitMock.setPrice(ALTERNATIVE_ETH_ADDRESS, token1.address, "1");
    await oneSplitMock.setPrice(token1.address, token2.address, "1");
    await oneSplitMock.setPrice(token2.address, ALTERNATIVE_ETH_ADDRESS, "1");

    // Apply partial function
    swapAndCheck = oneInchSwapAndCheck(oneInch);
  });

  it("Swap ETH -> TOKEN 1", async function() {
    await swapAndCheck({
      fromToken: ALTERNATIVE_ETH_ADDRESS,
      toToken: token1.address,
      amountWei: toWei("1"),
      userAddress: user
    });
  });

  it("Swap TOKEN 1 -> TOKEN 2", async function() {
    await swapAndCheck({
      fromToken: token1.address,
      toToken: token2.address,
      amountWei: toWei("1"),
      userAddress: user
    });
  });

  it("Swap TOKEN 2 -> ETH", async function() {
    await swapAndCheck({
      fromToken: token2.address,
      toToken: ALTERNATIVE_ETH_ADDRESS,
      amountWei: toWei("1"),
      userAddress: user
    });
  });
});
