const { toWei, utf8ToHex } = web3.utils;

const request = require("supertest");

// Script to test
const app = require("../../../scripts/severless-cloud-run/CloudRunSpoke");

// Create a supertest instance of the server exported from the cloud run spoke
// const req = request(server);

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

  before(async function() {
    collateralToken = await Token.new("DAI", "DAI", 18, { from: contractCreator });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(utf8ToHex("ETH/BTC"));
  });

  beforeEach(async function() {
    const constructorParams = {
      expirationTimestamp: "12345678900",
      withdrawalLiveness: "1000",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: utf8ToHex("ETH/BTC"),
      syntheticName: "ETH/BTC synthetic token",
      syntheticSymbol: "ETH/BTC",
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

    // Set two uniswap prices to give it a little history.
    await uniswap.setPrice(toWei("1"), toWei("1"));
    await uniswap.setPrice(toWei("1"), toWei("1"));
  });

  it("Cloud Run Spoke rejects invalid json request bodies", async function() {
    const emptyBody = {};
    const emptyBodyResponse = await request("http://localhost:8080")
      .post("/")
      .send(emptyBody);

    assert.equal(emptyBodyResponse.res.statusCode, 500); //error code
    assert.isTrue(emptyBodyResponse.res.text.includes("Process exited with error"));
    assert.isTrue(emptyBodyResponse.res.text.includes("Missing cloudRunCommand in json body"));

    // body missing cloud run command
    const invalidBody = { someRandomKey: "random input" };
    const invalidBodyResponse = await request("http://localhost:8080")
      .post("/")
      .send(invalidBody);
    assert.equal(invalidBodyResponse.res.statusCode, 500); //error code
    assert.isTrue(invalidBodyResponse.res.text.includes("Process exited with error"));
    assert.isTrue(invalidBodyResponse.res.text.includes("Missing cloudRunCommand in json body"));
  });
  it("Cloud Run Spoke can correctly execute bot logic with valid body", async function() {
    const validBody = {
      cloudRunCommand: "npx truffle exec packages/monitors/index.js --network test",
      environmentVariables: {
        POLLING_DELAY: 0,
        EMP_ADDRESS: emp.address,
        TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
      }
    };

    const validResponse = await request("http://localhost:8080")
      .post("/")
      .send(validBody)
      .set("Accept", "application/json");

    assert.equal(validResponse.res.statusCode, 200); //error code
    assert.isTrue(validResponse.res.text.includes("End of serverless execution loop - terminating process")); //error text
  });
  it("Cloud Run Spoke can correctly returns errors over http calls", async function() {
    // Invalid path should error out when trying to run an executable that does not exist
    const invalidPathBody = {
      cloudRunCommand: "npx truffle exec packages/INVALID/index.js --network test",
      environmentVariables: {
        POLLING_DELAY: 0,
        EMP_ADDRESS: emp.address,
        TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig // invalid config that should generate an error
      }
    };

    const invalidPathResponse = await request("http://localhost:8080")
      .post("/")
      .send(invalidPathBody)
      .set("Accept", "application/json");

    assert.equal(invalidPathResponse.res.statusCode, 500); //error code
    // Expected error text from an invalid path
    assert.isTrue(invalidPathResponse.res.text.includes("no such file or directory"));

    // Invalid config should error out before entering the main while loop in the bot.
    const invalidConfigBody = {
      cloudRunCommand: "npx truffle exec packages/monitors/index.js --network test",
      environmentVariables: {
        POLLING_DELAY: 0,
        // missing EMP_ADDRESS. Should error before entering main while loop.
        TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig // invalid config that should generate an error
      }
    };

    const invalidConfigResponse = await request("http://localhost:8080")
      .post("/")
      .send(invalidConfigBody)
      .set("Accept", "application/json");

    assert.equal(invalidConfigResponse.res.statusCode, 500); //error code
    // Expected error text from an invalid path
    assert.isTrue(
      invalidConfigResponse.res.text.includes(
        "Bad environment variables! Specify an `EMP_ADDRESS` for the location of the expiring Multi Party"
      )
    );
    // Invalid price feed config should error out before entering main while loop
    const invalidPriceFeed = {
      cloudRunCommand: "npx truffle exec packages/monitors/index.js --network test",
      environmentVariables: {
        POLLING_DELAY: 0,
        EMP_ADDRESS: emp.address,
        TOKEN_PRICE_FEED_CONFIG: null // invalid config that should generate an error
      }
    };

    const invalidPriceFeedResponse = await request("http://localhost:8080")
      .post("/")
      .send(invalidPriceFeed)
      .set("Accept", "application/json");

    assert.equal(invalidPriceFeedResponse.res.statusCode, 500); //error code
    // Expected error text from a null price feed
    assert.isTrue(invalidPriceFeedResponse.res.text.includes("Cannot read property 'type' of null"));

    // Invalid EMP address should error out when trying to retrieve on-chain data.
    const invalidEMPAddressBody = {
      cloudRunCommand: "npx truffle exec packages/monitors/index.js --network test",
      environmentVariables: {
        POLLING_DELAY: 0,
        EMP_ADDRESS: "0x0000000000000000000000000000000000000000", // Invalid address that should generate an error
        TOKEN_PRICE_FEED_CONFIG: defaultUniswapPricefeedConfig
      }
    };

    const invalidEMPAddressResponse = await request("http://localhost:8080")
      .post("/")
      .send(invalidEMPAddressBody)
      .set("Accept", "application/json");

    assert.equal(invalidEMPAddressResponse.res.statusCode, 500); //error code
    // Expected error text from loading in an EMP from an invalid address
    assert.isTrue(invalidEMPAddressResponse.res.text.includes("Returned values aren't valid, did it run Out of Gas?")); //error text
  });
});
