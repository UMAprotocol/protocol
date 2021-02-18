const winston = require("winston");
const sinon = require("sinon");

const { toWei, hexToUtf8, utf8ToHex, soliditySha3 } = web3.utils;

const {
  OptimisticOracleClient,
  GasEstimator,
  SpyTransport,
  lastSpyLogLevel,
  spyLogIncludes,
  PriceFeedMockScaled
} = require("@uma/financial-templates-lib");
const { OptimisticOracleProposer } = require("../src/proposer");
const { interfaceName, getPrecisionForIdentifier, OptimisticOracleRequestStatesEnum } = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

const CONTRACT_VERSION = "latest";

const OptimisticOracle = getTruffleContract("OptimisticOracle", web3, CONTRACT_VERSION);
const OptimisticRequesterTest = getTruffleContract("OptimisticRequesterTest", web3, CONTRACT_VERSION);
const Finder = getTruffleContract("Finder", web3, CONTRACT_VERSION);
const IdentifierWhitelist = getTruffleContract("IdentifierWhitelist", web3, CONTRACT_VERSION);
const Token = getTruffleContract("ExpandedERC20", web3, CONTRACT_VERSION);
const AddressWhitelist = getTruffleContract("AddressWhitelist", web3, CONTRACT_VERSION);
const Timer = getTruffleContract("Timer", web3, CONTRACT_VERSION);
const Store = getTruffleContract("Store", web3, CONTRACT_VERSION);
const MockOracle = getTruffleContract("MockOracleAncillary", web3, CONTRACT_VERSION);

contract("OptimisticOracle: proposer.js", function(accounts) {
  const owner = accounts[0];
  const requester = accounts[1];
  const randoProposer = accounts[2]; // Used when testing disputes
  const disputer = accounts[3];
  const botRunner = accounts[5];

  // Contracts
  let optimisticRequester;
  let optimisticOracle;
  let finder;
  let timer;
  let identifierWhitelist;
  let collateralWhitelist;
  let store;

  // Offchain infra
  let client;
  let gasEstimator;
  let proposer;
  let spyLogger;
  let mockOracle;
  let spy;

  // Timestamps that we'll use throughout the test.
  let requestTime;
  let startTime;

  // Default testing values.
  const liveness = 7200; // 2 hours
  const initialUserBalance = toWei("100");
  const finalFee = toWei("1");
  const totalDefaultBond = toWei("2"); // 2x final fee
  const disputablePrice = "9"; // Proposed price that should be disputed

  // These identifiers are special test ones that are mapped to certain `priceFeedDecimal`
  // configurations used to construct pricefeeds. For example, "TEST8DECIMALS" will construct
  // a pricefeed that returns prices in 8 decimals. This is useful for testing that a bot is
  // constructing the right type of pricefeed by default. This mapping is stored in @uma/common/PriceIdentifierUtils.js
  const identifiersToTest = [
    web3.utils.utf8ToHex("TEST8DECIMALS"),
    web3.utils.utf8ToHex("TEST6DECIMALS"),
    web3.utils.utf8ToHex("TEST18DECIMALS")
  ];
  let collateralCurrenciesForIdentifier;

  const verifyState = async (state, identifier, ancillaryData = "0x") => {
    assert.equal(
      (await optimisticOracle.getState(optimisticRequester.address, identifier, requestTime, ancillaryData)).toString(),
      state
    );
  };

  before(async function() {
    finder = await Finder.new();
    timer = await Timer.new();

    // Whitelist test identifiers we can use to make default price requests.
    identifierWhitelist = await IdentifierWhitelist.new();
    for (let i = 0; i < identifiersToTest.length; i++) {
      await identifierWhitelist.addSupportedIdentifier(identifiersToTest[i]);
    }
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.address);

    collateralWhitelist = await AddressWhitelist.new();
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.address);

    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);

    mockOracle = await MockOracle.new(finder.address, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);
  });

  beforeEach(async function() {
    // Create and save a new collateral token for each request so we can test
    // that proposer can use different currencies for each request to post bonds.
    collateralCurrenciesForIdentifier = [];
    for (let i = 0; i < identifiersToTest.length; i++) {
      let collateral = await Token.new("Wrapped Ether", "WETH", getPrecisionForIdentifier(identifiersToTest[i]));
      await collateral.addMember(1, owner);
      await collateral.mint(botRunner, initialUserBalance);
      await collateral.mint(requester, initialUserBalance);
      await collateral.mint(disputer, initialUserBalance);
      await collateral.mint(randoProposer, initialUserBalance);
      await collateralWhitelist.addToWhitelist(collateral.address);
      await store.setFinalFee(collateral.address, { rawValue: finalFee });
      collateralCurrenciesForIdentifier[i] = collateral;
    }

    optimisticOracle = await OptimisticOracle.new(liveness, finder.address, timer.address);

    // Contract used to make price requests
    optimisticRequester = await OptimisticRequesterTest.new(optimisticOracle.address);

    startTime = (await optimisticOracle.getCurrentTime()).toNumber();
    requestTime = startTime - 10;

    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });

    client = new OptimisticOracleClient(
      spyLogger,
      OptimisticOracle.abi,
      MockOracle.abi,
      web3,
      optimisticOracle.address,
      mockOracle.address
    );

    gasEstimator = new GasEstimator(spyLogger);
  });

  describe("Valid price identifiers", function() {
    // Test using packed token address as ancillary data to better simulate what will
    // happen with financial contracts
    let ancillaryDataAddresses = [];

    beforeEach(async function() {
      // Make a new price request for each identifier, each of which should cause the keeper bot to
      // construct a pricefeed with a new precision.
      for (let i = 0; i < identifiersToTest.length; i++) {
        let ancillaryData = soliditySha3({ t: "address", v: collateralCurrenciesForIdentifier[i].address });
        ancillaryDataAddresses[i] = ancillaryData;

        await optimisticRequester.requestPrice(
          identifiersToTest[i],
          requestTime,
          ancillaryData,
          collateralCurrenciesForIdentifier[i].address,
          0
        );
      }

      // Construct OO Proposer using a valid default price feed config containing any additional properties
      // not set in DefaultPriceFeedConfig
      let defaultPriceFeedConfig = {
        currentPrice: "1", // Mocked current price. This will be scaled to the identifier's precision.
        historicalPrice: "2" // Mocked historical price. This will be scaled to the identifier's precision.
      };
      proposer = new OptimisticOracleProposer({
        logger: spyLogger,
        optimisticOracleClient: client,
        gasEstimator,
        account: botRunner,
        defaultPriceFeedConfig
      });

      // Update the bot to read the new OO state.
      await proposer.update();
    });

    it("_setAllowances", async function() {
      // Calling it once should set allowances
      await proposer._setAllowances();

      // Check for the successful INFO log emitted by the proposer.
      assert.equal(lastSpyLogLevel(spy), "info");
      assert.isTrue(spyLogIncludes(spy, -1, "Approved OO to transfer unlimited collateral tokens"));
      const totalCalls = spy.callCount;

      // Should have sent one INFO log for each currency approved.
      assert.equal(spy.callCount, collateralCurrenciesForIdentifier.length);

      // Calling it again should skip setting allowances.
      await proposer._setAllowances();
      assert.equal(totalCalls, spy.callCount);
    });

    it("Can send proposals to new price requests", async function() {
      // Should have one price request for each identifier.
      let expectedResults = [];
      for (let i = 0; i < identifiersToTest.length; i++) {
        expectedResults.push({
          requester: optimisticRequester.address,
          identifier: hexToUtf8(identifiersToTest[i]),
          ancillaryData: ancillaryDataAddresses[i],
          timestamp: requestTime.toString(),
          currency: collateralCurrenciesForIdentifier[i].address,
          reward: "0",
          finalFee
        });
      }
      let result = client.getUnproposedPriceRequests();
      assert.deepStrictEqual(result, expectedResults);

      // Now: Execute `sendProposals()` and test that the bot correctly responds to these price proposals
      await proposer.sendProposals();

      // Check that the onchain requests have been proposed to.
      for (let i = 0; i < identifiersToTest.length; i++) {
        await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED, identifiersToTest[i], ancillaryDataAddresses[i]);
      }

      // Check for the successful INFO log emitted by the proposer.
      assert.equal(lastSpyLogLevel(spy), "info");
      assert.isTrue(spyLogIncludes(spy, -1, "Proposed price"));
      let spyCallCount = spy.callCount;

      // After one run, the pricefeed classes should all be cached in the proposer bot's state:
      for (let i = 0; i < identifiersToTest.length; i++) {
        assert.isTrue(
          proposer.priceFeedCache[web3.utils.hexToUtf8(identifiersToTest[i])] instanceof PriceFeedMockScaled
        );
      }

      // Updating and calling `sendProposals` again does nothing.
      await proposer.update();
      await proposer.sendProposals();
      assert.equal(spy.callCount, spyCallCount);
    });

    it("Can send disputes to proposals", async function() {
      // Should have one price request for each identifier.
      let expectedRequests = [];
      for (let i = 0; i < identifiersToTest.length; i++) {
        expectedRequests.push({
          requester: optimisticRequester.address,
          identifier: hexToUtf8(identifiersToTest[i]),
          ancillaryData: ancillaryDataAddresses[i],
          timestamp: requestTime.toString(),
          currency: collateralCurrenciesForIdentifier[i].address,
          reward: "0",
          finalFee
        });
      }
      let result = client.getUnproposedPriceRequests();
      assert.deepStrictEqual(result, expectedRequests);

      // Should have one proposal for each identifier
      let expectedProposals = [];
      for (let i = 0; i < identifiersToTest.length; i++) {
        let collateralCurrency = collateralCurrenciesForIdentifier[i];
        await collateralCurrency.approve(optimisticOracle.address, totalDefaultBond, { from: randoProposer });
        await optimisticOracle.proposePrice(
          optimisticRequester.address,
          identifiersToTest[i],
          requestTime,
          ancillaryDataAddresses[i],
          disputablePrice,
          {
            from: randoProposer
          }
        );
        expectedProposals.push({
          requester: optimisticRequester.address,
          identifier: hexToUtf8(identifiersToTest[i]),
          ancillaryData: ancillaryDataAddresses[i],
          timestamp: requestTime.toString(),
          proposer: randoProposer,
          proposedPrice: disputablePrice,
          expirationTimestamp: (startTime + liveness).toString(),
          currency: collateralCurrenciesForIdentifier[i].address
        });
      }
      await proposer.update();
      result = client.getUndisputedProposals();
      assert.deepStrictEqual(result, expectedProposals);

      // Now: Execute `sendDisputes()` and test that the bot correctly responds to these price proposals
      await proposer.sendDisputes();

      // Check that the onchain proposals have been disputed.
      for (let i = 0; i < identifiersToTest.length; i++) {
        await verifyState(OptimisticOracleRequestStatesEnum.DISPUTED, identifiersToTest[i], ancillaryDataAddresses[i]);
      }

      // Check for the successful INFO log emitted by the proposer.
      assert.equal(lastSpyLogLevel(spy), "info");
      assert.isTrue(spyLogIncludes(spy, -1, "Disputed proposal"));
      let spyCallCount = spy.callCount;

      // After one run, the pricefeed classes should all be cached in the proposer bot's state:
      for (let i = 0; i < identifiersToTest.length; i++) {
        assert.isTrue(
          proposer.priceFeedCache[web3.utils.hexToUtf8(identifiersToTest[i])] instanceof PriceFeedMockScaled
        );
      }

      // Updating and calling `sendDisputes` again does nothing.
      await proposer.update();
      await proposer.sendDisputes();
      assert.equal(spy.callCount, spyCallCount);
    });

    it("Correctly caches created price feeds", async function() {
      // Submit another price request (with a different timestamp) for an identifier that is already used.
      await optimisticRequester.requestPrice(
        identifiersToTest[0],
        requestTime + 1,
        "0x",
        collateralCurrenciesForIdentifier[0].address,
        0
      );
      // Update the proposer since the OO state has changed
      await proposer.update();

      // Call `sendProposals` which should create a new pricefeed for each identifier.
      await proposer.sendProposals();

      // Check that only 1 price feed is cached for each unique identifier, which also tests that the re-requested
      // identifier (with a diff timestamp) does not create 2 pricefeeds.
      assert.equal(Object.keys(proposer.priceFeedCache).length, identifiersToTest.length);

      // Call `sendDisputes` which should just fetch pricefeeds from the cache instead of creating new ones.
      await proposer.sendDisputes();
      assert.equal(Object.keys(proposer.priceFeedCache).length, identifiersToTest.length);
    });
  });

  it("Skip price requests with identifiers that proposer cannot construct a price feed for", async function() {
    // Request a valid identifier but set an invalid price feed config:
    await optimisticRequester.requestPrice(
      identifiersToTest[0],
      requestTime,
      "0x",
      collateralCurrenciesForIdentifier[0].address,
      0
    );

    // This pricefeed config will cause the proposer to fail to construct a price feed because the
    // PriceFeedMock type requires a `currentPrice` and a `historicalPrice` to be specified, which are missing
    // here (and also not included in the DefaultPriceFeedConfig for the tested identifiers).
    let invalidPriceFeedConfig = {};
    proposer = new OptimisticOracleProposer({
      logger: spyLogger,
      optimisticOracleClient: client,
      gasEstimator,
      account: botRunner,
      defaultPriceFeedConfig: invalidPriceFeedConfig
    });
    await proposer.update();

    // `sendProposals`: Should throw an error
    await proposer.sendProposals();
    assert.equal(lastSpyLogLevel(spy), "error");
    assert.isTrue(spyLogIncludes(spy, -1, "Failed to construct a PriceFeed for price request"));
    assert.isTrue(spyLogIncludes(spy, -1, "sendProposals"));

    // Manually send proposal.
    const collateralCurrency = collateralCurrenciesForIdentifier[0];
    await collateralCurrency.approve(optimisticOracle.address, totalDefaultBond, { from: randoProposer });
    await optimisticOracle.proposePrice(
      optimisticRequester.address,
      identifiersToTest[0],
      requestTime,
      "0x",
      disputablePrice,
      {
        from: randoProposer
      }
    );

    // `sendDisputes`: Should throw another error
    await proposer.update();
    await proposer.sendDisputes();
    assert.equal(lastSpyLogLevel(spy), "error");
    assert.isTrue(spyLogIncludes(spy, -1, "Failed to construct a PriceFeed for price request"));
    assert.isTrue(spyLogIncludes(spy, -1, "sendDisputes"));
  });

  it("Skip price requests with historical prices that proposer fails to fetch", async function() {
    // Request a valid identifier that is getting bad data from the data source.
    // Note: "INVALID" maps specifically to the InvalidPriceFeedMock in the DefaultPriceFeedConfig.js file.
    const invalidPriceFeedIdentifier = web3.utils.utf8ToHex("INVALID");
    await identifierWhitelist.addSupportedIdentifier(invalidPriceFeedIdentifier);
    await optimisticRequester.requestPrice(
      invalidPriceFeedIdentifier,
      requestTime,
      "0x",
      collateralCurrenciesForIdentifier[0].address,
      // collateral token doesn't matter as the error should log before its used
      0
    );
    proposer = new OptimisticOracleProposer({
      logger: spyLogger,
      optimisticOracleClient: client,
      gasEstimator,
      account: botRunner
    });
    await proposer.update();
    await proposer.sendProposals();

    // `sendProposals`: Should throw an error
    await proposer.sendProposals();
    assert.equal(lastSpyLogLevel(spy), "error");
    assert.isTrue(spyLogIncludes(spy, -1, "Failed to query historical price for price request"));
    assert.isTrue(spyLogIncludes(spy, -1, "sendProposals"));

    // Manually send proposal.
    const collateralCurrency = collateralCurrenciesForIdentifier[0];
    await collateralCurrency.approve(optimisticOracle.address, totalDefaultBond, { from: randoProposer });
    await optimisticOracle.proposePrice(
      optimisticRequester.address,
      invalidPriceFeedIdentifier,
      requestTime,
      "0x",
      disputablePrice,
      {
        from: randoProposer
      }
    );

    // `sendDisputes`: Should throw another error
    await proposer.update();
    await proposer.sendDisputes();
    assert.equal(lastSpyLogLevel(spy), "error");
    assert.isTrue(spyLogIncludes(spy, -1, "Failed to query historical price for price request"));
    assert.isTrue(spyLogIncludes(spy, -1, "sendDisputes"));
  });

  // TODO:
  // Can settle requests
});
