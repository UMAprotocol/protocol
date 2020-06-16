const { toWei, utf8ToHex } = web3.utils;
const fetch = require("node-fetch");
const { delay } = require("../../financial-templates-lib/helpers/delay");
const { MAX_UINT_VAL } = require("../../common/Constants");

// Script to test
const Poll = require("../index.js");

// Contracts and helpers
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const Token = artifacts.require("ExpandedERC20");
const Timer = artifacts.require("Timer");
const UniswapMock = artifacts.require("UniswapMock");

contract("index.js", function(accounts) {
  const contractCreator = accounts[0];

  let collateralToken;
  let syntheticToken;
  let emp;
  let uniswap;

  let defaultPricefeedConfig;

  before(async function() {
    collateralToken = await Token.new("UMA", "UMA", 18, { from: contractCreator });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(utf8ToHex("UMATEST"));
  });

  beforeEach(async function() {
    const constructorParams = {
      expirationTimestamp: "12345678900",
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      liquidationLiveness: "1000",
      collateralRequirement: { rawValue: toWei("1.2") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("1") },
      timerAddress: Timer.address
    };

    // Deploy a new expiring multi party
    emp = await ExpiringMultiParty.new(constructorParams);

    syntheticToken = await Token.at(await emp.tokenCurrency());

    uniswap = await UniswapMock.new();

    defaultPricefeedConfig = {
      type: "uniswap",
      uniswapAddress: uniswap.address,
      twapLength: 1,
      lookback: 1
    };

    // Set two uniswap prices to give it a little history.
    await uniswap.setPrice(toWei("1"), toWei("1"));
    await uniswap.setPrice(toWei("1"), toWei("1"));
  });

  it("Completes one iteration without throwing an error", async function() {
    const address = emp.address;

    const priceFeedConfig = defaultPricefeedConfig;

    let errorThrown = false;
    try {
      await Poll.run(address, 0, priceFeedConfig);
    } catch (err) {
      errorThrown = true;
    }
    assert.isFalse(errorThrown);
  });

  it("Sets token allowances correctly", async function() {
    const priceFeedConfig = defaultPricefeedConfig;

    await Poll.run(emp.address, 0, priceFeedConfig);

    const collateralAllowance = await collateralToken.allowance(contractCreator, emp.address);
    assert.equal(collateralAllowance.toString(), MAX_UINT_VAL);
    const syntheticAllowance = await syntheticToken.allowance(contractCreator, emp.address);
    assert.equal(syntheticAllowance.toString(), MAX_UINT_VAL);
  });
  // TODO: remove this test when we remove the black box testing URL.
  it("Responds to incoming monitor requests while bot is alive", async function() {
    const address = emp.address;

    const priceFeedConfig = defaultPricefeedConfig;

    const monitorPort = 3333;
    const url = `http://localhost:${monitorPort}`;
    const route = "/";

    // Pinging server while bot is dead should throw an error.
    let errorThrown = false;
    try {
      await fetch(`${url}${route}`);
    } catch (err) {
      errorThrown = true;
    }
    assert.isTrue(errorThrown);

    // Start bot synchronously so that we can attempt to send a request to the monitor server without
    // having to wait for the `run` method to return. Wait a little bit for bot to start before sending the request.
    Poll.run(address, 0, priceFeedConfig, monitorPort);
    await delay(1); // Empirically, anything > 100 ms seems to be sufficient delay.

    // Pinging server while bot is alive should succeed.
    const response = await fetch(`${url}${route}`);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.message, "Bot is up");
  });
});
