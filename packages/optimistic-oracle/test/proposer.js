const winston = require("winston");
const sinon = require("sinon");

const { toWei, hexToUtf8, utf8ToHex, toBN } = web3.utils;

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
  let mockOracle;

  // Offchain infra
  let client;
  let gasEstimator;
  let proposer;
  let spyLogger;
  let spy;

  // Timestamps that we'll use throughout the test.
  let requestTime;
  let startTime;

  // Default testing values.
  const liveness = 7200; // 2 hours
  const initialUserBalance = toWei("100");
  const finalFee = toWei("1");
  const totalDefaultBond = toWei("2"); // 2x final fee

  // These identifiers are special test ones that are mapped to certain `priceFeedDecimal`
  // configurations used to construct pricefeeds. For example, "TEST8DECIMALS" will construct
  // a pricefeed that returns prices in 8 decimals. This is useful for testing that a bot is
  // constructing the right type of pricefeed by default. This mapping is stored in @uma/common/PriceIdentifierUtils.js
  const identifiersToTest = [
    web3.utils.utf8ToHex("TEST8DECIMALS"),
    web3.utils.utf8ToHex("TEST6DECIMALS"),
    web3.utils.utf8ToHex("TEST18DECIMALS"),
    web3.utils.utf8ToHex("TEST18DECIMALS")
  ];
  let collateralCurrenciesForIdentifier;

  const verifyState = async (state, identifier, ancillaryData = "0x") => {
    assert.equal(
      (await optimisticOracle.getState(optimisticRequester.address, identifier, requestTime, ancillaryData)).toString(),
      state
    );
  };

  const pushPrice = async price => {
    const [lastQuery] = (await mockOracle.getPendingQueries()).slice(-1);
    await mockOracle.pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price);
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

    let commonPriceFeedConfig;

    beforeEach(async function() {
      // Make a new price request for each identifier, each of which should cause the keeper bot to
      // construct a pricefeed with a new precision.
      for (let i = 0; i < identifiersToTest.length; i++) {
        // To simulate a requested price from the EMP, the collateral currency should be in
        // lower case since the EMP contract will convert from address to bytes.
        let ancillaryData = collateralCurrenciesForIdentifier[i].address.toLowerCase();
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
      commonPriceFeedConfig = {
        currentPrice: "1.2", // Mocked current price. This will be scaled to the identifier's precision.
        historicalPrice: "2.4" // Mocked historical price. This will be scaled to the identifier's precision.
      };
      // For this test, we'll dispute any proposals that are not equal to historical price up to a
      // 10% margin of error
      let optimisticOracleProposerConfig = {
        disputePriceErrorPercent: 0.1
      };
      proposer = new OptimisticOracleProposer({
        logger: spyLogger,
        optimisticOracleClient: client,
        gasEstimator,
        account: botRunner,
        commonPriceFeedConfig,
        optimisticOracleProposerConfig
      });

      // Update the bot to read the new OO state.
      await proposer.update();
    });

    it("_setAllowances", async function() {
      // Calling it once should set allowances
      await proposer._setAllowances();

      // Check for the successful INFO log emitted by the proposer.
      assert.equal(lastSpyLogLevel(spy), "info");
      assert.isTrue(spyLogIncludes(spy, -1, "Approved OptimisticOracle to transfer unlimited collateral tokens"));
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
      assert.equal(spy.getCall(-1).lastArg.proposalBond, totalDefaultBond);
      assert.ok(spy.getCall(-1).lastArg.proposalResult.tx);
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

      // Propose a price for each request:
      // 1) "TEST8DECIMALS"
      // 2) "TEST6DECIMALS"
      // 3) "TEST18DECIMALS"
      // 4) "TEST18DECIMALS"

      // The historical price is 2.4.
      // Dispute prices must be within 10% of 2.4, so the allowed range is [2.16, 2.64]
      let disputablePrices = [
        // 2.17e8
        // - NOT DISPUTED.
        "216000000",
        // 2.15e6
        // - DISPUTED
        "2150000",
        // 2.65e18
        // - DISPUTED
        "2650000000000000000",
        // 2.63e18
        // - NOT DISPUTED
        "2640000000000000000"
      ];
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
          disputablePrices[i],
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
          proposedPrice: disputablePrices[i],
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
      // Check also that the first and the last proposal are NOT disputed
      for (let i = 1; i < identifiersToTest.length - 1; i++) {
        await verifyState(OptimisticOracleRequestStatesEnum.DISPUTED, identifiersToTest[i], ancillaryDataAddresses[i]);
      }
      await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED, identifiersToTest[0], ancillaryDataAddresses[0]);
      await verifyState(
        OptimisticOracleRequestStatesEnum.PROPOSED,
        identifiersToTest[identifiersToTest.length - 1],
        ancillaryDataAddresses[identifiersToTest.length - 1]
      );

      // Check for the successful INFO log emitted by the proposer.
      assert.equal(lastSpyLogLevel(spy), "info");
      assert.isTrue(spyLogIncludes(spy, -1, "Disputed proposal"));
      assert.equal(spy.getCall(-1).lastArg.disputeBond, totalDefaultBond);
      assert.ok(spy.getCall(-1).lastArg.disputeResult.tx);
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

    it("Can settle proposals and disputes", async function() {
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

      // Make one proposal for bot to dispute:
      let collateralCurrency = collateralCurrenciesForIdentifier[0];
      await collateralCurrency.approve(optimisticOracle.address, totalDefaultBond, { from: randoProposer });
      await optimisticOracle.proposePrice(
        optimisticRequester.address,
        identifiersToTest[0],
        requestTime,
        ancillaryDataAddresses[0],
        "1", // Arbitrary price that bot will dispute
        {
          from: randoProposer
        }
      );

      // Now make the bot propose to the remaining requests.
      await proposer.update();
      await proposer.sendProposals();

      // Finally, execute `sendDisputes()` and dispute the first proposal we made.
      await proposer.update();
      await proposer.sendDisputes();

      // Check that the requests are in the correct state.
      await verifyState(OptimisticOracleRequestStatesEnum.DISPUTED, identifiersToTest[0], ancillaryDataAddresses[0]);
      for (let i = 1; i < identifiersToTest.length; i++) {
        await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED, identifiersToTest[i], ancillaryDataAddresses[i]);
      }

      // Now, advance time so that the proposals expire and check that the bot can settle the proposals
      await optimisticOracle.setCurrentTime((Number(startTime) + liveness).toString());
      await proposer.update();
      let spyCountPreSettle = spy.callCount;
      await proposer.settleRequests();

      // Check that all of the bot's proposals have been settled.
      for (let i = 1; i < identifiersToTest.length; i++) {
        await verifyState(OptimisticOracleRequestStatesEnum.SETTLED, identifiersToTest[i], ancillaryDataAddresses[i]);
      }
      assert.equal(lastSpyLogLevel(spy), "info");
      assert.isTrue(spyLogIncludes(spy, -1, "Settled proposal or dispute"));
      assert.equal(spy.getCall(-1).lastArg.payout, totalDefaultBond);
      assert.ok(spy.getCall(-1).lastArg.settleResult.tx);
      assert.equal(spy.callCount, spyCountPreSettle + (identifiersToTest.length - 1));

      // Finally resolve the dispute and check that the bot settles the dispute.
      // Push an arbitrary price, as it doesn't matter in this test who wins the dispute, just that it resolves.
      await pushPrice("1");
      await proposer.update();
      spyCountPreSettle = spy.callCount;
      await proposer.settleRequests();

      // Check that the bot's dispute has been settled.
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED, identifiersToTest[0], ancillaryDataAddresses[0]);
      assert.equal(lastSpyLogLevel(spy), "info");
      assert.isTrue(spyLogIncludes(spy, -1, "Settled proposal or dispute"));
      // Note: payout is equal to original default bond + 1/2 of loser's dispute bond (not including loser's final fee)
      assert.equal(spy.getCall(-1).lastArg.payout, toBN(totalDefaultBond).add(toBN(finalFee).divn(2)));
      assert.ok(spy.getCall(-1).lastArg.settleResult.tx);
      assert.equal(spy.callCount, spyCountPreSettle + 1);
    });

    it("Correctly caches created price feeds", async function() {
      // Call `sendProposals` which should create a new pricefeed for each identifier.
      await proposer.sendProposals();

      // Check that only 1 price feed is cached for each unique identifier, which also tests that the re-requested
      // identifier does not create 2 pricefeeds.
      assert.equal(Object.keys(proposer.priceFeedCache).length, identifiersToTest.length - 1);

      // Call `sendDisputes` which should just fetch pricefeeds from the cache instead of creating new ones.
      await proposer.sendDisputes();
      assert.equal(Object.keys(proposer.priceFeedCache).length, identifiersToTest.length - 1);
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
      commonPriceFeedConfig: invalidPriceFeedConfig
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
    await optimisticOracle.proposePrice(optimisticRequester.address, identifiersToTest[0], requestTime, "0x", "1", {
      from: randoProposer
    });

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
      "1",
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

  it("Cannot set disputePriceErrorPercent < 0 or >= 1", async function() {
    try {
      new OptimisticOracleProposer({
        logger: spyLogger,
        optimisticOracleClient: client,
        gasEstimator,
        account: botRunner,
        optimisticOracleProposerConfig: { disputePriceErrorPercent: -0.1 }
      });
      assert(false);
    } catch (err) {
      assert.isTrue(err.message.includes("invalid value on disputePriceErrorPercent"));
    }
    try {
      new OptimisticOracleProposer({
        logger: spyLogger,
        optimisticOracleClient: client,
        gasEstimator,
        account: botRunner,
        optimisticOracleProposerConfig: { disputePriceErrorPercent: 1 }
      });
      assert(false);
    } catch (err) {
      assert.isTrue(err.message.includes("invalid value on disputePriceErrorPercent"));
    }
  });
});
