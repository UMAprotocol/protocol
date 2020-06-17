const { toWei, utf8ToHex } = web3.utils;
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

  let defaultUniswapPricefeedConfig;
  let defaultMedianizerPricefeedConfig;
  let defaultBotMonitorConfig;
  let defaultWalletMonitorConfig;
  let defaultContractMonitorConfig;
  let defaultSyntheticPegMonitorConfig;

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

    defaultUniswapPricefeedConfig = {
      type: "uniswap",
      uniswapAddress: uniswap.address,
      twapLength: 1,
      lookback: 1
    };

    defaultMedianizerPricefeedConfig = {
      type: "medianizer",
      apiKey: "test-apikey",
      pair: "ethbtc",
      lookback: 1,
      minTimeBetweenUpdates: 1,
      medianizedFeeds: [
        {
          type: "cryptowatch",
          exchange: "binance"
        }
      ]
    };

    defaultBotMonitorConfig = [];
    defaultWalletMonitorConfig = [];
    defaultContractMonitorConfig = { monitoredLiquidators: [], monitoredDisputers: [] };
    defaultSyntheticPegMonitorConfig = {
      deviationAlertThreshold: 0.5,
      volatilityWindow: 600,
      volatilityAlertThreshold: 0.1
    };

    // Set two uniswap prices to give it a little history.
    await uniswap.setPrice(toWei("1"), toWei("1"));
    await uniswap.setPrice(toWei("1"), toWei("1"));
  });

  it("Completes one iteration without throwing an error", async function() {
    const address = emp.address;

    let errorThrown = false;
    try {
      await Poll.run(
        address,
        false,
        defaultBotMonitorConfig,
        defaultWalletMonitorConfig,
        defaultContractMonitorConfig,
        defaultSyntheticPegMonitorConfig,
        10_000,
        defaultUniswapPricefeedConfig,
        defaultMedianizerPricefeedConfig
      );
    } catch (err) {
      errorThrown = true;
    }
    assert.isFalse(errorThrown);
  });
});
