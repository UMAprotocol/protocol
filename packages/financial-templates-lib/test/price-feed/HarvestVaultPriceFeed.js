const { web3, getContract } = require("hardhat");
const { assert } = require("chai");
const winston = require("winston");

const { HarvestVaultPriceFeed } = require("../../dist/price-feed/VaultPriceFeed");
const { advanceBlockAndSetTime, parseFixed } = require("@uma/common");
const { BlockFinder } = require("../../dist/price-feed/utils");

const VaultMock = getContract("HarvestVaultMock");
const VaultInterface = getContract("HarvestVaultInterface");
const ERC20Interface = getContract("IERC20Standard");
const ERC20 = getContract("ExpandedERC20");

describe("HarvestVaultPriceFeed.js", function () {
  let owner, accounts;

  let vaultMock;
  let vaultPriceFeed;
  let erc20;
  let mockTime = 0;
  let dummyLogger;
  let priceFeedDecimals = 8;
  let tokenDecimals = 6;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner] = accounts;
  });

  beforeEach(async function () {
    erc20 = await ERC20.new("Test Token", "TT", tokenDecimals).send({ from: owner });
    vaultMock = await VaultMock.new(erc20.options.address).send({ from: owner });

    dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    vaultPriceFeed = new HarvestVaultPriceFeed({
      logger: dummyLogger,
      web3,
      getTime: () => mockTime,
      vaultAbi: VaultInterface.abi,
      erc20Abi: ERC20Interface.abi,
      vaultAddress: vaultMock.options.address,
      priceFeedDecimals,
    });
  });

  it("Basic current price", async function () {
    await vaultMock.methods.setPricePerFullShare(parseFixed("50", tokenDecimals)).send({ from: accounts[0] });
    await vaultPriceFeed.update();

    assert.equal(vaultPriceFeed.getCurrentPrice().toString(), parseFixed("50", priceFeedDecimals).toString());
  });

  it("Correctly selects most recent price", async function () {
    await vaultMock.methods.setPricePerFullShare(parseFixed("50", tokenDecimals)).send({ from: accounts[0] });
    await vaultMock.methods.setPricePerFullShare(parseFixed("100", tokenDecimals)).send({ from: accounts[0] });
    await vaultMock.methods.setPricePerFullShare(parseFixed("0.1", tokenDecimals)).send({ from: accounts[0] });
    await vaultPriceFeed.update();

    assert.equal(vaultPriceFeed.getCurrentPrice().toString(), parseFixed("0.1", priceFeedDecimals).toString());
  });

  it("Historical Price", async function () {
    await vaultPriceFeed.update();

    await vaultMock.methods.setPricePerFullShare(parseFixed("50", tokenDecimals)).send({ from: accounts[0] });

    // Ensure that the next block is mined at a later time.
    const { timestamp: firstPriceTimestamp } = await web3.eth.getBlock("latest");
    await advanceBlockAndSetTime(web3, firstPriceTimestamp + 10);

    await vaultMock.methods.setPricePerFullShare(parseFixed("10", tokenDecimals)).send({ from: accounts[0] });

    const { timestamp: secondPriceTimestamp } = await web3.eth.getBlock("latest");

    assert.equal(
      (await vaultPriceFeed.getHistoricalPrice(firstPriceTimestamp)).toString(),
      parseFixed("50", priceFeedDecimals)
    );
    assert.equal(
      (await vaultPriceFeed.getHistoricalPrice(firstPriceTimestamp + 5)).toString(),
      parseFixed("50", priceFeedDecimals)
    );
    assert.equal(
      (await vaultPriceFeed.getHistoricalPrice(secondPriceTimestamp - 1)).toString(),
      parseFixed("50", priceFeedDecimals)
    );
    assert.equal(
      (await vaultPriceFeed.getHistoricalPrice(secondPriceTimestamp)).toString(),
      parseFixed("10", priceFeedDecimals)
    );
  });

  it("Update Frequency", async function () {
    await vaultMock.methods.setPricePerFullShare(parseFixed("50", tokenDecimals)).send({ from: accounts[0] });
    await vaultPriceFeed.update();
    assert.equal(vaultPriceFeed.getCurrentPrice().toString(), parseFixed("50", priceFeedDecimals).toString());
    const initialTime = mockTime;
    assert.equal(vaultPriceFeed.getLastUpdateTime(), initialTime);

    // Increment time to just under the 1 minute default threshold and push a new price.
    mockTime += 59;
    await vaultMock.methods.setPricePerFullShare(parseFixed("10", tokenDecimals)).send({ from: accounts[0] });
    await vaultPriceFeed.update();
    assert.equal(vaultPriceFeed.getLastUpdateTime(), initialTime); // No change in update time.

    // Price should not have changed.
    assert.equal(vaultPriceFeed.getCurrentPrice().toString(), parseFixed("50", priceFeedDecimals).toString());

    // An increment of one more secont + update should trigger the feed to pull in the new price.
    mockTime += 1;
    await vaultPriceFeed.update();
    assert.equal(vaultPriceFeed.getCurrentPrice().toString(), parseFixed("10", priceFeedDecimals).toString());
    assert.equal(vaultPriceFeed.getLastUpdateTime(), mockTime); // Update time should have no incremented.
  });

  it("PriceFeedDecimals", async function () {
    assert.equal(vaultPriceFeed.getPriceFeedDecimals(), priceFeedDecimals);
  });

  it("BlockFinder correctly passed in", async function () {
    const blockFinder = new BlockFinder(() => {
      throw "err";
    }); // BlockFinder should throw immediately.
    vaultPriceFeed = new HarvestVaultPriceFeed({
      logger: dummyLogger,
      web3,
      getTime: () => mockTime,
      vaultAbi: VaultInterface.abi,
      erc20Abi: ERC20Interface.abi,
      vaultAddress: vaultMock.options.address,
      priceFeedDecimals,
      blockFinder,
    });

    await vaultPriceFeed.update();
    // Blockfinder is used to grab a historical price. Should throw.
    assert.isTrue(await vaultPriceFeed.getHistoricalPrice(100).catch(() => true));
  });
});
