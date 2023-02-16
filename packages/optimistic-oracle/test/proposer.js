const winston = require("winston");
const sinon = require("sinon");
const hre = require("hardhat");
const { getContract } = hre;
const { assert } = require("chai");

const { toWei, hexToUtf8, utf8ToHex, padRight } = web3.utils;

const {
  OptimisticOracleClient,
  GasEstimator,
  SpyTransport,
  lastSpyLogLevel,
  spyLogIncludes,
  PriceFeedMockScaled,
} = require("@uma/financial-templates-lib");
const { OptimisticOracleProposer } = require("../src/proposer");
const { interfaceName, getPrecisionForIdentifier, OptimisticOracleRequestStatesEnum } = require("@uma/common");

const OptimisticOracle = getContract("OptimisticOracle");
const OptimisticRequesterTest = getContract("OptimisticRequesterTest");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Token = getContract("ExpandedERC20");
const AddressWhitelist = getContract("AddressWhitelist");
const Store = getContract("Store");
const MockOracle = getContract("MockOracleAncillary");
const Timer = getContract("Timer");

const objectsInArrayInclude = (superset, subset) => {
  assert.equal(superset.length, subset.length);
  for (let i = 0; i < superset.length; i++) assert.deepInclude(superset[i], subset[i]);
};

describe("OptimisticOracle: proposer.js", function () {
  let owner;
  let requester;
  let randoProposer;
  let disputer;
  let botRunner;

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
    padRight(utf8ToHex("TEST8DECIMALS"), 64),
    padRight(utf8ToHex("TEST6DECIMALS"), 64),
    padRight(utf8ToHex("TEST18DECIMALS"), 64),
    padRight(utf8ToHex("TEST18DECIMALS"), 64),
  ];

  const ignoredIdentifiersPostExpiry = ["TESTBLACKLIST"];
  const ignoredIdentifiers = ["IGNORE"];
  let collateralCurrenciesForIdentifier;

  const verifyState = async (state, identifier, ancillaryData = "0x", time = requestTime) => {
    assert.equal(
      (await optimisticOracle.methods.getState(requester, identifier, time, ancillaryData).call()).toString(),
      state
    );
  };

  const pushPrice = async (price) => {
    const [lastQuery] = (await mockOracle.methods.getPendingQueries().call()).slice(-1);
    await mockOracle.methods
      .pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price)
      .send({ from: owner });
  };

  before(async function () {
    [owner, requester, randoProposer, disputer, botRunner] = await web3.eth.getAccounts();

    finder = await Finder.new().send({ from: owner });
    timer = await Timer.new().send({ from: owner });
    identifierWhitelist = await IdentifierWhitelist.new().send({ from: owner });
    collateralWhitelist = await AddressWhitelist.new().send({ from: owner });
    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: owner });
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });

    // Whitelist test identifiers we can use to make default price requests.
    for (let i = 0; i < identifiersToTest.length; i++) {
      await identifierWhitelist.methods.addSupportedIdentifier(identifiersToTest[i]).send({ from: owner });
    }

    // Add deployed contracts to finder.
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.AddressWhitelist), collateralWhitelist.options.address)
      .send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: owner });
  });

  beforeEach(async function () {
    // Create and save a new collateral token for each request so we can test
    // that proposer can use different currencies for each request to post bonds.
    collateralCurrenciesForIdentifier = [];
    for (let i = 0; i < identifiersToTest.length; i++) {
      let collateral = await Token.new("Wrapped Ether", "WETH", getPrecisionForIdentifier(identifiersToTest[i])).send({
        from: owner,
      });
      await collateral.methods.addMember(1, owner).send({ from: owner });
      await collateral.methods.mint(botRunner, initialUserBalance).send({ from: owner });
      await collateral.methods.mint(requester, initialUserBalance).send({ from: owner });
      await collateral.methods.mint(disputer, initialUserBalance).send({ from: owner });
      await collateral.methods.mint(randoProposer, initialUserBalance).send({ from: owner });
      await collateralWhitelist.methods.addToWhitelist(collateral.options.address).send({ from: owner });
      await store.methods.setFinalFee(collateral.options.address, { rawValue: finalFee }).send({ from: owner });
      collateralCurrenciesForIdentifier[i] = collateral;
    }

    optimisticOracle = await OptimisticOracle.new(liveness, finder.options.address, timer.options.address).send({
      from: owner,
    });

    // Contract used to make price requests
    optimisticRequester = await OptimisticRequesterTest.new(optimisticOracle.options.address).send({ from: owner });

    startTime = Number(await optimisticOracle.methods.getCurrentTime().call());
    requestTime = startTime - 10;

    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })],
    });

    client = new OptimisticOracleClient(
      spyLogger,
      OptimisticOracle.abi,
      MockOracle.abi,
      web3,
      optimisticOracle.options.address,
      mockOracle.options.address
    );

    gasEstimator = new GasEstimator(spyLogger);
  });

  describe("Valid price identifiers", function () {
    // Test using packed token address as ancillary data to better simulate what will
    // happen with financial contracts
    let ancillaryDataAddresses = [];

    let commonPriceFeedConfig;

    beforeEach(async function () {
      // Make a new price request for each identifier, each of which should cause the keeper bot to
      // construct a pricefeed with a new precision.
      for (let i = 0; i < identifiersToTest.length; i++) {
        // To simulate a requested price from the EMP, the collateral currency should be in
        // lower case since the EMP contract will convert from address to bytes.
        let ancillaryData = collateralCurrenciesForIdentifier[i].options.address.toLowerCase();
        ancillaryDataAddresses[i] = ancillaryData;

        await optimisticOracle.methods
          .requestPrice(
            identifiersToTest[i],
            requestTime,
            ancillaryData,
            collateralCurrenciesForIdentifier[i].options.address,
            0
          )
          .send({ from: requester });
      }

      // Construct OO Proposer using a valid default price feed config containing any additional properties
      // not set in DefaultPriceFeedConfig
      commonPriceFeedConfig = {
        currentPrice: "1.2", // Mocked current price. This will be scaled to the identifier's precision.
        historicalPrice: "2.4", // Mocked historical price. This will be scaled to the identifier's precision.
      };
      // For this test, we'll dispute any proposals that are not equal to historical price up to a
      // 10% margin of error
      let optimisticOracleProposerConfig = { disputePriceErrorPercent: 0.1, otherAccountsToSettle: [randoProposer] };
      proposer = new OptimisticOracleProposer({
        logger: spyLogger,
        optimisticOracleClient: client,
        gasEstimator,
        account: botRunner,
        commonPriceFeedConfig,
        optimisticOracleProposerConfig,
        ignoredIdentifiers,
        ignoredIdentifiersPostExpiry,
      });

      // Update the bot to read the new OO state.
      await proposer.update();
    });

    it("_setAllowances", async function () {
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

    it("Can send proposals to new price requests", async function () {
      // Should have one price request for each identifier.
      let expectedResults = [];
      for (let i = 0; i < identifiersToTest.length; i++) {
        expectedResults.push({
          requester: requester,
          identifier: hexToUtf8(identifiersToTest[i]),
          ancillaryData: ancillaryDataAddresses[i],
          timestamp: requestTime.toString(),
          currency: collateralCurrenciesForIdentifier[i].options.address,
          reward: "0",
          finalFee,
        });
      }
      let result = client.getUnproposedPriceRequests();
      objectsInArrayInclude(result, expectedResults);

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

    it("Can send disputes to proposals", async function () {
      // Should have one price request for each identifier.
      let expectedRequests = [];
      for (let i = 0; i < identifiersToTest.length; i++) {
        expectedRequests.push({
          requester: requester,
          identifier: hexToUtf8(identifiersToTest[i]),
          ancillaryData: ancillaryDataAddresses[i],
          timestamp: requestTime.toString(),
          currency: collateralCurrenciesForIdentifier[i].options.address,
          reward: "0",
          finalFee,
        });
      }
      let result = client.getUnproposedPriceRequests();
      objectsInArrayInclude(result, expectedRequests);

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
        "2640000000000000000",
      ];
      // Should have one proposal for each identifier
      let expectedProposals = [];
      for (let i = 0; i < identifiersToTest.length; i++) {
        let collateralCurrency = collateralCurrenciesForIdentifier[i];
        await collateralCurrency.methods
          .approve(optimisticOracle.options.address, totalDefaultBond)
          .send({ from: randoProposer });
        await optimisticOracle.methods
          .proposePrice(requester, identifiersToTest[i], requestTime, ancillaryDataAddresses[i], disputablePrices[i])
          .send({ from: randoProposer });
        expectedProposals.push({
          requester: requester,
          identifier: hexToUtf8(identifiersToTest[i]),
          ancillaryData: ancillaryDataAddresses[i],
          timestamp: requestTime.toString(),
          proposer: randoProposer,
          proposedPrice: disputablePrices[i],
          expirationTimestamp: (startTime + liveness).toString(),
          currency: collateralCurrenciesForIdentifier[i].options.address,
        });
      }
      await proposer.update();
      result = client.getUndisputedProposals();
      objectsInArrayInclude(result, expectedProposals);

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

    it("Can settle proposals and disputes", async function () {
      // Should have one price request for each identifier.
      let expectedRequests = [];
      for (let i = 0; i < identifiersToTest.length; i++) {
        expectedRequests.push({
          requester: requester,
          identifier: hexToUtf8(identifiersToTest[i]),
          ancillaryData: ancillaryDataAddresses[i],
          timestamp: requestTime.toString(),
          currency: collateralCurrenciesForIdentifier[i].options.address,
          reward: "0",
          finalFee,
        });
      }
      let result = client.getUnproposedPriceRequests();
      objectsInArrayInclude(result, expectedRequests);

      // Make one proposal for bot to dispute:
      let collateralCurrency = collateralCurrenciesForIdentifier[0];
      await collateralCurrency.methods
        .approve(optimisticOracle.options.address, totalDefaultBond)
        .send({ from: randoProposer });
      await optimisticOracle.methods
        .proposePrice(
          requester,
          identifiersToTest[0],
          requestTime,
          ancillaryDataAddresses[0],
          toWei("1") // Arbitrary price that bot will dispute
        )
        .send({ from: randoProposer });

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
      await optimisticOracle.methods.setCurrentTime((Number(startTime) + liveness).toString()).send({ from: owner });
      await proposer.update();
      let spyCountPreSettle = spy.callCount;
      await proposer.settleRequests();

      // Check that all of the bot's proposals have been settled.
      for (let i = 1; i < identifiersToTest.length; i++) {
        await verifyState(OptimisticOracleRequestStatesEnum.SETTLED, identifiersToTest[i], ancillaryDataAddresses[i]);
      }
      assert.equal(lastSpyLogLevel(spy), "info");
      assert.isTrue(spyLogIncludes(spy, -1, "Settled proposal"));
      assert.isTrue(spyLogIncludes(spy, -1, "2.00")); // total default bond of 2e18, scaled by wei
      assert.isTrue(spyLogIncludes(spy, -1, "tx")); // contains a tx hash
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
      assert.isTrue(spyLogIncludes(spy, -1, "Settled dispute"));
      // Note: payout is equal to original default bond + 1/2 of loser's dispute bond (not including loser's final fee)
      assert.isTrue(spyLogIncludes(spy, -1, "2.50")); // total default bond of 2e18 + half looser bond of 0.5e18, scaled by wei
      assert.isTrue(spyLogIncludes(spy, -1, "tx")); // contains a tx hash
      assert.equal(spy.callCount, spyCountPreSettle + 1);
    });

    it("Can settle other account's proposals", async function () {
      // Make one proposal for bot to settle.
      let collateralCurrency = collateralCurrenciesForIdentifier[0];
      await collateralCurrency.methods
        .approve(optimisticOracle.options.address, totalDefaultBond)
        .send({ from: randoProposer });
      await optimisticOracle.methods
        .proposePrice(
          requester,
          identifiersToTest[0],
          requestTime,
          ancillaryDataAddresses[0],
          toWei("1") // Arbitrary price that bot will dispute
        )
        .send({ from: randoProposer });

      // Now, advance time so that the proposals expire and check that the bot can settle the proposals
      await optimisticOracle.methods.setCurrentTime((Number(startTime) + liveness).toString()).send({ from: owner });

      // Now make the bot settle the requests.
      await proposer.update();
      await proposer.settleRequests();

      // Check that the requests are in the correct state.
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED, identifiersToTest[0], ancillaryDataAddresses[0]);
    });

    it("Can settle other anyone's proposals", async function () {
      // Create new proposer to inject a custom config.
      proposer = new OptimisticOracleProposer({
        logger: spyLogger,
        optimisticOracleClient: client,
        gasEstimator,
        account: botRunner,
        commonPriceFeedConfig,
        optimisticOracleProposerConfig: { disputePriceErrorPercent: 0.1, settleAllRequests: true },
        ignoredIdentifiers,
        ignoredIdentifiersPostExpiry,
      });

      // Make one proposal for bot to settle.
      let collateralCurrency = collateralCurrenciesForIdentifier[0];
      await collateralCurrency.methods
        .approve(optimisticOracle.options.address, totalDefaultBond)
        .send({ from: randoProposer });
      await optimisticOracle.methods
        .proposePrice(
          requester,
          identifiersToTest[0],
          requestTime,
          ancillaryDataAddresses[0],
          toWei("1") // Arbitrary price that bot will dispute
        )
        .send({ from: randoProposer });

      // Now, advance time so that the proposals expire and check that the bot can settle the proposals
      await optimisticOracle.methods.setCurrentTime((Number(startTime) + liveness).toString()).send({ from: owner });

      // Now make the bot settle the requests.
      await proposer.update();
      await proposer.settleRequests();

      // Check that the requests are in the correct state.
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED, identifiersToTest[0], ancillaryDataAddresses[0]);
    });

    it("Correctly caches created price feeds", async function () {
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

  it("Skip price requests with identifiers that proposer cannot construct a price feed for", async function () {
    // Request a valid identifier but set an invalid price feed config:
    await optimisticOracle.methods
      .requestPrice(identifiersToTest[0], requestTime, "0x", collateralCurrenciesForIdentifier[0].options.address, 0)
      .send({ from: requester });

    // This pricefeed config will cause the proposer to fail to construct a price feed because the
    // PriceFeedMock type requires a `currentPrice` and a `historicalPrice` to be specified, which are missing
    // here (and also not included in the DefaultPriceFeedConfig for the tested identifiers).
    let invalidPriceFeedConfig = {};
    proposer = new OptimisticOracleProposer({
      logger: spyLogger,
      optimisticOracleClient: client,
      gasEstimator,
      account: botRunner,
      commonPriceFeedConfig: invalidPriceFeedConfig,
      ignoredIdentifiers,
      ignoredIdentifiersPostExpiry,
    });
    await proposer.update();

    // `sendProposals`: Should throw an error
    await proposer.sendProposals();
    assert.equal(lastSpyLogLevel(spy), "error");
    assert.isTrue(spyLogIncludes(spy, -1, "Failed to construct a PriceFeed for price request"));
    assert.isTrue(spyLogIncludes(spy, -1, "sendProposals"));

    // Manually send proposal.
    const collateralCurrency = collateralCurrenciesForIdentifier[0];
    await collateralCurrency.methods
      .approve(optimisticOracle.options.address, totalDefaultBond)
      .send({ from: randoProposer });
    await optimisticOracle.methods
      .proposePrice(requester, identifiersToTest[0], requestTime, "0x", toWei("1"))
      .send({ from: randoProposer });

    // `sendDisputes`: Should throw another error
    await proposer.update();
    await proposer.sendDisputes();
    assert.equal(lastSpyLogLevel(spy), "error");
    assert.isTrue(spyLogIncludes(spy, -1, "Failed to construct a PriceFeed for price request"));
    assert.isTrue(spyLogIncludes(spy, -1, "sendDisputes"));
  });

  it("Skip price requests with historical prices that proposer fails to fetch", async function () {
    // Request a valid identifier that is getting bad data from the data source.
    // Note: "INVALID" maps specifically to the InvalidPriceFeedMock in the DefaultPriceFeedConfig.js file.
    const invalidPriceFeedIdentifier = padRight(utf8ToHex("INVALID"), 64);
    await identifierWhitelist.methods.addSupportedIdentifier(invalidPriceFeedIdentifier).send({ from: owner });
    await optimisticOracle.methods
      .requestPrice(
        invalidPriceFeedIdentifier,
        requestTime,
        "0x",
        collateralCurrenciesForIdentifier[0].options.address,
        // collateral token doesn't matter as the error should log before its used
        0
      )
      .send({ from: requester });
    proposer = new OptimisticOracleProposer({
      logger: spyLogger,
      optimisticOracleClient: client,
      gasEstimator,
      account: botRunner,
      ignoredIdentifiers,
      ignoredIdentifiersPostExpiry,
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
    await collateralCurrency.methods
      .approve(optimisticOracle.options.address, totalDefaultBond)
      .send({ from: randoProposer });
    await optimisticOracle.methods
      .proposePrice(requester, invalidPriceFeedIdentifier, requestTime, "0x", toWei("1"))
      .send({ from: randoProposer });

    // `sendDisputes`: Should throw another error
    await proposer.update();
    await proposer.sendDisputes();
    assert.equal(lastSpyLogLevel(spy), "error");
    assert.isTrue(spyLogIncludes(spy, -1, "Failed to query historical price for price request"));
    assert.isTrue(spyLogIncludes(spy, -1, "sendDisputes"));
  });

  it("Skips expiry price requests for expiry-blacklisted identifiers", async function () {
    // Set requester's expiration timestamp to be equal to the price request timestamp to simulate expiry:
    await optimisticRequester.methods.setExpirationTimestamp(requestTime).send({ from: owner });

    const collateralCurrency = collateralCurrenciesForIdentifier[0];
    const ancillaryData = collateralCurrency.options.address.toLowerCase();
    const ancillaryDataAddress = ancillaryData;

    // Use the test blacklisted identifier.
    const identifierToIgnore = padRight(utf8ToHex(ignoredIdentifiersPostExpiry[0]), 64);
    await identifierWhitelist.methods.addSupportedIdentifier(identifierToIgnore).send({ from: owner });

    await optimisticRequester.methods
      .requestPrice(identifierToIgnore, requestTime, ancillaryData, collateralCurrency.options.address, 0)
      .send({ from: owner });

    // Use debug spy to catch "skip" log.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
    proposer = new OptimisticOracleProposer({
      logger: spyLogger,
      optimisticOracleClient: client,
      gasEstimator,
      account: botRunner,
      commonPriceFeedConfig: { currentPrice: "1", historicalPrice: "2" },
      ignoredIdentifiers,
      ignoredIdentifiersPostExpiry,
    });

    // Update the bot to read the new OO state.
    await proposer.update();

    // Client should still see the unproposed price request:
    objectsInArrayInclude(client.getUnproposedPriceRequests(), [
      {
        requester: optimisticRequester.options.address,
        identifier: hexToUtf8(identifierToIgnore),
        ancillaryData: ancillaryDataAddress,
        timestamp: requestTime.toString(),
        currency: collateralCurrency.options.address,
        reward: "0",
        finalFee,
      },
    ]);

    // Running the bot's sendProposals method should skip the price request which it sees as an expiry request:
    await proposer.sendProposals();
    assert.equal(lastSpyLogLevel(spy), "debug");
    assert.isTrue(
      spyLogIncludes(spy, -1, "EMP contract has expired and identifier's price resolution logic transforms post-expiry")
    );
    assert.equal(spy.getCall(-1).lastArg.expirationTimestamp, requestTime);

    // Show that if the contract's expiration timestamp were 1 second later, then the bot would not interpret the price
    // request as an expiry one and would propose
    await optimisticRequester.methods.setExpirationTimestamp(Number(requestTime) + 1).send({ from: owner });
    await proposer.update();
    await proposer.sendProposals();

    assert.equal(
      (
        await optimisticOracle.methods
          .getState(optimisticRequester.options.address, identifierToIgnore, requestTime, ancillaryDataAddress)
          .call()
      ).toString(),
      OptimisticOracleRequestStatesEnum.PROPOSED
    );
    assert.equal(lastSpyLogLevel(spy), "info");
    assert.isTrue(spyLogIncludes(spy, -1, "Proposed price"));
    assert.ok(spy.getCall(-1).lastArg.proposalResult.tx);

    // Resetting the expiration timestamp should make sendDispute to skip the price request:
    await optimisticRequester.methods.setExpirationTimestamp(requestTime).send({ from: owner });
    await proposer.update();
    await proposer.sendDisputes();
    assert.equal(lastSpyLogLevel(spy), "debug");
    assert.isTrue(
      spyLogIncludes(spy, -1, "EMP contract has expired and identifier's price resolution logic transforms post-expiry")
    );
    assert.equal(spy.getCall(-1).lastArg.expirationTimestamp, requestTime);

    // Finally, if the contract's expiration timestamp is set 1 second later, then the bot would not interpret the price
    // request as an expiry one and could dispute (but won't dispute because the dispute price equals the proposed one).
    await optimisticRequester.methods.setExpirationTimestamp(Number(requestTime) + 1).send({ from: owner });
    await proposer.update();
    await proposer.sendDisputes();
    assert.isTrue(spyLogIncludes(spy, -1, "Skipping dispute because proposal price is within allowed margin of error"));
  });

  it("Skips all price requests for master-blacklisted identifiers", async function () {
    const collateralCurrency = collateralCurrenciesForIdentifier[0];
    const ancillaryData = collateralCurrency.options.address.toLowerCase();
    const ancillaryDataAddress = ancillaryData;

    const identifierToIgnore = padRight(utf8ToHex(ignoredIdentifiers[0]), 64);
    await identifierWhitelist.methods.addSupportedIdentifier(identifierToIgnore).send({ from: owner });

    await optimisticOracle.methods
      .requestPrice(identifierToIgnore, requestTime, ancillaryData, collateralCurrency.options.address, 0)
      .send({ from: requester });

    // Use debug spy to catch "skip" log.
    spyLogger = winston.createLogger({
      level: "debug",
      transports: [new SpyTransport({ level: "debug" }, { spy: spy })],
    });
    proposer = new OptimisticOracleProposer({
      logger: spyLogger,
      optimisticOracleClient: client,
      gasEstimator,
      account: botRunner,
      commonPriceFeedConfig: { currentPrice: "1", historicalPrice: "2" },
      ignoredIdentifiers,
      ignoredIdentifiersPostExpiry,
    });

    // Update the bot to read the new OO state.
    await proposer.update();

    // No allowances should be set for blacklisted identifier
    assert.equal(lastSpyLogLevel(spy), "debug");
    assert.isTrue(spyLogIncludes(spy, -1, "Identifier is blacklisted"));

    // Client should still see the unproposed price request:
    objectsInArrayInclude(client.getUnproposedPriceRequests(), [
      {
        requester: requester,
        identifier: hexToUtf8(identifierToIgnore),
        ancillaryData: ancillaryDataAddress,
        timestamp: requestTime.toString(),
        currency: collateralCurrency.options.address,
        reward: "0",
        finalFee,
      },
    ]);

    // Running the bot's sendProposals method should skip the price request:
    await proposer.sendProposals();
    assert.equal(lastSpyLogLevel(spy), "debug");
    assert.isTrue(spyLogIncludes(spy, -1, "Identifier is blacklisted"));
    await verifyState(OptimisticOracleRequestStatesEnum.REQUESTED, identifierToIgnore, ancillaryDataAddress);
  });
});
