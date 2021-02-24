const winston = require("winston");

const { VaultPriceFeed } = require("../../src/price-feed/VaultPriceFeed");
const { advanceBlockAndSetTime, parseFixed } = require("@uma/common");
const { BlockFinder } = require("../../src/price-feed/utils");
const { getTruffleContract } = require("@uma/core");

const CONTRACT_VERSION = "latest";

const VaultMock = getTruffleContract("VaultMock", web3, CONTRACT_VERSION);
const VaultInterface = getTruffleContract("VaultInterface", web3, CONTRACT_VERSION);
const ERC20Interface = getTruffleContract("IERC20Standard", web3, CONTRACT_VERSION);
const ERC20 = getTruffleContract("ExpandedERC20", web3, CONTRACT_VERSION);

contract("VaultPriceFeed.js", function(accounts) {
  const owner = accounts[0];

  let vaultMock;
  let vaultPriceFeed;
  let erc20;
  let mockTime = 0;
  let dummyLogger;
  let priceFeedDecimals = 8;
  let tokenDecimals = 6;

  beforeEach(async function() {
    erc20 = await ERC20.new("Test Token", "TT", tokenDecimals, { from: owner });
    vaultMock = await VaultMock.new(erc20.address, { from: owner });

    dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });

    vaultPriceFeed = new VaultPriceFeed({
      logger: dummyLogger,
      web3,
      getTime: () => mockTime,
      vaultAbi: VaultInterface.abi,
      erc20Abi: ERC20Interface.abi,
      vaultAddress: vaultMock.address,
      priceFeedDecimals
    });
  });

  it("Basic current price", async function() {
    await vaultMock.setPricePerFullShare(parseFixed("50", tokenDecimals));
    await vaultPriceFeed.update();

    assert.equal(vaultPriceFeed.getCurrentPrice().toString(), parseFixed("50", priceFeedDecimals).toString());
  });

  it("Correctly selects most recent price", async function() {
    await vaultMock.setPricePerFullShare(parseFixed("50", tokenDecimals));
    await vaultMock.setPricePerFullShare(parseFixed("100", tokenDecimals));
    await vaultMock.setPricePerFullShare(parseFixed("0.1", tokenDecimals));
    await vaultPriceFeed.update();

    assert.equal(vaultPriceFeed.getCurrentPrice().toString(), parseFixed("0.1", priceFeedDecimals).toString());
  });

  it("Historical Price", async function() {
    await vaultPriceFeed.update();

    await vaultMock.setPricePerFullShare(parseFixed("50", tokenDecimals));

    // Ensure that the next block is mined at a later time.
    const { timestamp: firstPriceTimestamp } = await web3.eth.getBlock("latest");
    await advanceBlockAndSetTime(web3, firstPriceTimestamp + 10);

    await vaultMock.setPricePerFullShare(parseFixed("10", tokenDecimals));

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

  it("Update Frequency", async function() {
    await vaultMock.setPricePerFullShare(parseFixed("50", tokenDecimals));
    await vaultPriceFeed.update();
    assert.equal(vaultPriceFeed.getCurrentPrice().toString(), parseFixed("50", priceFeedDecimals).toString());
    const initialTime = mockTime;
    assert.equal(vaultPriceFeed.getLastUpdateTime(), initialTime);

    // Increment time to just under the 1 minute default threshold and push a new price.
    mockTime += 59;
    await vaultMock.setPricePerFullShare(parseFixed("10", tokenDecimals));
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

  it("PriceFeedDecimals", async function() {
    assert.equal(vaultPriceFeed.getPriceFeedDecimals(), priceFeedDecimals);
  });

  it("BlockFinder correctly passed in", async function() {
    const blockFinder = BlockFinder(() => {
      throw "err";
    }); // BlockFinder should throw immediately.
    vaultPriceFeed = new VaultPriceFeed({
      logger: dummyLogger,
      web3,
      getTime: () => mockTime,
      vaultAbi: VaultInterface.abi,
      erc20Abi: ERC20Interface.abi,
      vaultAddress: vaultMock.address,
      priceFeedDecimals,
      blockFinder
    });

    await vaultPriceFeed.update();
    // Blockfinder is used to grab a historical price. Should throw.
    assert.isTrue(await vaultPriceFeed.getHistoricalPrice(100).catch(() => true));
  });
});
