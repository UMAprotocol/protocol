const { getContract, web3 } = require("hardhat");
const { assert } = require("chai");

const winston = require("winston");
const sinon = require("sinon");

const { toWei, hexToUtf8, utf8ToHex } = web3.utils;

const { OptimisticOracleContractMonitor } = require("../src/OptimisticOracleContractMonitor");
const { interfaceName, MAX_UINT_VAL } = require("@uma/common");

const {
  OptimisticOracleEventClient,
  SpyTransport,
  lastSpyLogIncludes,
  lastSpyLogLevel,
  OptimisticOracleType,
} = require("@uma/financial-templates-lib");

const OptimisticOracle = getContract("OptimisticOracle");
const SkinnyOptimisticOracle = getContract("SkinnyOptimisticOracle");
const OptimisticRequesterTest = getContract("OptimisticRequesterTest");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Token = getContract("ExpandedERC20");
const AddressWhitelist = getContract("AddressWhitelist");
const Timer = getContract("Timer");
const Store = getContract("Store");
const MockOracle = getContract("MockOracleAncillary");

describe("OptimisticOracleContractMonitor.js", function () {
  let accounts;
  let owner;
  let requester;
  let proposer;
  let skinnyProposer;
  let disputer;

  let optimisticRequester;
  let optimisticOracle;
  let skinnyOptimisticOracle;
  let eventClient;
  let skinnyEventClient;
  let contractMonitor;
  let skinnyContractMonitor;
  let spyLogger;
  let mockOracle;
  let contractProps;
  let monitorConfig;
  let spy;

  let finder;
  let timer;
  let identifierWhitelist;
  let collateralWhitelist;
  let store;
  let collateral;

  // Timestamps that we'll use throughout the test.
  let requestTime;
  let startTime;
  let proposalTime;

  // Default testing values.
  const liveness = 7200; // 2 hours
  const initialUserBalance = toWei("100");
  const finalFee = toWei("1");
  const reward = toWei("3");
  const correctPrice = toWei("-17"); // Arbitrary price to use as the correct price for proposals + disputes
  const identifier = web3.utils.utf8ToHex("Test Identifier");
  const defaultAncillaryData = "0x";
  const alternativeAncillaryData = "0x1234";

  const pushPrice = async (price) => {
    const [lastQuery] = (await mockOracle.methods.getPendingQueries().call()).slice(-1);
    await mockOracle.methods
      .pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price)
      .send({ from: owner });
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, requester, proposer, skinnyProposer, disputer] = accounts;
    finder = await Finder.new().send({ from: owner });
    timer = await Timer.new().send({ from: owner });

    // Whitelist an initial identifier we can use to make default price requests.
    identifierWhitelist = await IdentifierWhitelist.new().send({ from: owner });
    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: owner });

    collateralWhitelist = await AddressWhitelist.new().send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: owner });

    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: owner });
  });

  let requestTxn, proposalTxn, disputeTxn, settlementTxn;
  let skinnyRequestTxn, skinnyProposalTxn, skinnyDisputeTxn, skinnySettlementTxn;
  beforeEach(async function () {
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });

    // Deploy and whitelist a new collateral currency that we will use to pay oracle fees.
    collateral = await Token.new("Wrapped Ether", "WETH", 18).send({ from: owner });
    await collateral.methods.addMember(1, owner).send({ from: owner });
    await collateral.methods.mint(owner, initialUserBalance).send({ from: owner });
    await collateral.methods.mint(proposer, initialUserBalance).send({ from: owner });
    await collateral.methods.mint(skinnyProposer, initialUserBalance).send({ from: owner });
    await collateral.methods.mint(requester, initialUserBalance).send({ from: owner });
    await collateral.methods.mint(disputer, initialUserBalance).send({ from: owner });
    await collateralWhitelist.methods.addToWhitelist(collateral.options.address).send({ from: owner });

    // Set a non-0 final fee for the collateral currency.
    await store.methods.setFinalFee(collateral.options.address, { rawValue: finalFee }).send({ from: owner });

    optimisticOracle = await OptimisticOracle.new(liveness, finder.options.address, timer.options.address).send({
      from: owner,
    });
    skinnyOptimisticOracle = await SkinnyOptimisticOracle.new(
      liveness,
      finder.options.address,
      timer.options.address
    ).send({ from: owner });

    // Contract used to make price requests. Mint it some collateral to pay rewards with.
    optimisticRequester = await OptimisticRequesterTest.new(optimisticOracle.options.address).send({ from: owner });
    await collateral.methods.mint(optimisticRequester.options.address, initialUserBalance).send({ from: owner });

    startTime = parseInt(await optimisticOracle.methods.getCurrentTime().call());
    requestTime = startTime - 10;

    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston
    // logs the correct text based on interactions with the OptimisticOracle contract. Note that only `info` level messages are captured.
    spy = sinon.spy();
    spyLogger = winston.createLogger({ level: "info", transports: [new SpyTransport({ level: "info" }, { spy })] });

    eventClient = new OptimisticOracleEventClient(
      spyLogger,
      OptimisticOracle.abi,
      web3,
      optimisticOracle.options.address,
      OptimisticOracleType.OptimisticOracle,
      0, // startingBlockNumber
      null // endingBlockNumber
    );
    skinnyEventClient = new OptimisticOracleEventClient(
      spyLogger,
      SkinnyOptimisticOracle.abi,
      web3,
      skinnyOptimisticOracle.options.address,
      OptimisticOracleType.SkinnyOptimisticOracle,
      0, // startingBlockNumber
      null // endingBlockNumber
    );

    monitorConfig = {};
    contractProps = { networkId: await web3.eth.net.getId() };

    contractMonitor = new OptimisticOracleContractMonitor({
      logger: spyLogger,
      optimisticOracleContractEventClient: eventClient,
      monitorConfig,
      contractProps,
    });
    skinnyContractMonitor = new OptimisticOracleContractMonitor({
      logger: spyLogger,
      optimisticOracleContractEventClient: skinnyEventClient,
      monitorConfig,
      contractProps,
    });

    // Make price requests
    requestTxn = await optimisticRequester.methods
      .requestPrice(identifier, requestTime, defaultAncillaryData, collateral.options.address, reward)
      .send({ from: owner });
    await collateral.methods.approve(skinnyOptimisticOracle.options.address, MAX_UINT_VAL).send({ from: requester });
    skinnyRequestTxn = await skinnyOptimisticOracle.methods
      .requestPrice(identifier, requestTime, defaultAncillaryData, collateral.options.address, reward, finalFee, 0)
      .send({ from: requester });

    // Make proposals
    await collateral.methods.approve(optimisticOracle.options.address, MAX_UINT_VAL).send({ from: proposer });
    await collateral.methods
      .approve(skinnyOptimisticOracle.options.address, MAX_UINT_VAL)
      .send({ from: skinnyProposer });
    proposalTime = await optimisticOracle.methods.getCurrentTime().call();
    proposalTxn = await optimisticOracle.methods
      .proposePrice(optimisticRequester.options.address, identifier, requestTime, defaultAncillaryData, correctPrice)
      .send({ from: proposer });
    const requestEvents = await skinnyOptimisticOracle.getPastEvents("RequestPrice", { fromBlock: 0 });
    skinnyProposalTxn = await skinnyOptimisticOracle.methods
      .proposePrice(
        requester,
        identifier,
        requestTime,
        defaultAncillaryData,
        requestEvents[0].returnValues.request,
        correctPrice
      )
      .send({ from: skinnyProposer });

    // Make disputes and resolve them
    await collateral.methods.approve(optimisticOracle.options.address, MAX_UINT_VAL).send({ from: disputer });
    await collateral.methods.approve(skinnyOptimisticOracle.options.address, MAX_UINT_VAL).send({ from: disputer });
    disputeTxn = await optimisticOracle.methods
      .disputePrice(optimisticRequester.options.address, identifier, requestTime, defaultAncillaryData)
      .send({ from: disputer });
    await pushPrice(correctPrice);
    const proposeEvents = await skinnyOptimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 });
    skinnyDisputeTxn = await skinnyOptimisticOracle.methods
      .disputePrice(requester, identifier, requestTime, defaultAncillaryData, proposeEvents[0].returnValues.request)
      .send({ from: disputer });
    await pushPrice(correctPrice);

    // Settle expired proposals and resolved disputes
    settlementTxn = await optimisticOracle.methods
      .settle(optimisticRequester.options.address, identifier, requestTime, defaultAncillaryData)
      .send({ from: owner });
    const disputeEvents = await skinnyOptimisticOracle.getPastEvents("DisputePrice", { fromBlock: 0 });
    skinnySettlementTxn = await skinnyOptimisticOracle.methods
      .settle(requester, identifier, requestTime, defaultAncillaryData, disputeEvents[0].returnValues.request)
      .send({ from: owner });
  });

  it("Winston correctly emits price request message", async function () {
    await eventClient.update();
    await contractMonitor.checkForRequests();

    assert.equal(lastSpyLogLevel(spy), "error");

    // Should contain etherscan addresses for the requester and transaction
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${optimisticRequester.options.address}`));
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${requestTxn.transactionHash}`));

    // should contain the correct request information.
    assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
    assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
    assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
    assert.isTrue(lastSpyLogIncludes(spy, collateral.options.address)); // Currency
    assert.isTrue(lastSpyLogIncludes(spy, "3.00")); // Reward, formatted correctly
    assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // Final Fee
    let spyCount = spy.callCount;

    // Make another request with different ancillary data.
    const newTxn = await optimisticRequester.methods
      .requestPrice(identifier, requestTime, alternativeAncillaryData, collateral.options.address, reward)
      .send({ from: owner });
    await eventClient.update();
    await contractMonitor.checkForRequests();
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.transactionHash}`));
    assert.isTrue(lastSpyLogIncludes(spy, alternativeAncillaryData)); // Ancillary Data

    // Check that only one extra event was emitted since we already "checked" the original events.
    assert.equal(spy.callCount, spyCount + 1);
  });
  it("Winston correctly emits price proposal message", async function () {
    await eventClient.update();
    await contractMonitor.checkForProposals();

    assert.equal(lastSpyLogLevel(spy), "error");

    // Should contain etherscan addresses for the proposer and transaction
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${proposer}`));
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${proposalTxn.transactionHash}`));

    // should contain the correct proposal information.
    assert.isTrue(lastSpyLogIncludes(spy, optimisticRequester.options.address)); // Requester
    assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
    assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
    assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
    assert.isTrue(lastSpyLogIncludes(spy, collateral.options.address)); // Currency
    assert.isTrue(lastSpyLogIncludes(spy, "-17.00")); // Proposed Price
    assert.isTrue(lastSpyLogIncludes(spy, (Number(proposalTime) + liveness).toString())); // Expiration time
    let spyCount = spy.callCount;

    // Make another proposal with different ancillary data.
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, alternativeAncillaryData, collateral.options.address, reward)
      .send({ from: owner });
    const newTxn = await optimisticOracle.methods
      .proposePrice(
        optimisticRequester.options.address,
        identifier,
        requestTime,
        alternativeAncillaryData,
        correctPrice
      )
      .send({ from: proposer });
    await eventClient.update();
    await contractMonitor.checkForProposals();
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.transactionHash}`));
    assert.isTrue(lastSpyLogIncludes(spy, alternativeAncillaryData)); // Ancillary Data

    // Check that only one extra event was emitted since we already "checked" the original events.
    assert.equal(spy.callCount, spyCount + 1);
  });
  it("Winston correctly emits price dispute message", async function () {
    await eventClient.update();
    await contractMonitor.checkForDisputes();

    assert.equal(lastSpyLogLevel(spy), "error");

    // Should contain etherscan addresses for the disputer and transaction
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${disputer}`));
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${disputeTxn.transactionHash}`));

    // should contain the correct dispute information.
    assert.isTrue(lastSpyLogIncludes(spy, optimisticRequester.options.address)); // Requester
    assert.isTrue(lastSpyLogIncludes(spy, proposer)); // Proposer
    assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
    assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
    assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
    assert.isTrue(lastSpyLogIncludes(spy, "-17.00")); // Proposed Price
    let spyCount = spy.callCount;

    // Make another dispute with different ancillary data.
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, alternativeAncillaryData, collateral.options.address, reward)
      .send({ from: owner });
    await optimisticOracle.methods
      .proposePrice(
        optimisticRequester.options.address,
        identifier,
        requestTime,
        alternativeAncillaryData,
        correctPrice
      )
      .send({ from: proposer });
    const newTxn = await optimisticOracle.methods
      .disputePrice(optimisticRequester.options.address, identifier, requestTime, alternativeAncillaryData)
      .send({ from: disputer });
    await eventClient.update();
    await contractMonitor.checkForDisputes();
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.transactionHash}`));
    assert.isTrue(lastSpyLogIncludes(spy, alternativeAncillaryData)); // Ancillary Data

    // Check that only one extra event was emitted since we already "checked" the original events.
    assert.equal(spy.callCount, spyCount + 1);
  });
  it("Winston correctly emits price settlement message", async function () {
    await eventClient.update();
    await contractMonitor.checkForSettlements();

    assert.equal(lastSpyLogLevel(spy), "info");

    // Should contain etherscan addresses for the transaction
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${settlementTxn.transactionHash}`));

    // should contain the correct settlement information.
    assert.isTrue(lastSpyLogIncludes(spy, optimisticRequester.options.address)); // Requester
    assert.isTrue(lastSpyLogIncludes(spy, proposer)); // Proposer
    assert.isTrue(lastSpyLogIncludes(spy, disputer)); // Disputer
    assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
    assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
    assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
    assert.isTrue(lastSpyLogIncludes(spy, "17.00")); // Price
    // Proposal was disputed, payout made to winner of disputer
    // Dispute reward equals: default bond (2x final fee) + proposal reward + 1/2 of loser's final fee
    // = (2 * 1) + 3 + (0.5 * 1) = 5.5
    assert.isTrue(lastSpyLogIncludes(spy, "payout was 5.50 made to the winner of the dispute"));
    let spyCount = spy.callCount;

    // Make another settlement without a dispute, with different ancillary data.
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, alternativeAncillaryData, collateral.options.address, reward)
      .send({ from: owner });
    const newProposalTime = await optimisticOracle.methods.getCurrentTime().call();
    await optimisticOracle.methods
      .proposePrice(
        optimisticRequester.options.address,
        identifier,
        requestTime,
        alternativeAncillaryData,
        correctPrice
      )
      .send({ from: proposer });
    await optimisticOracle.methods
      .setCurrentTime((Number(newProposalTime) + liveness).toString())
      .send({ from: owner });
    const newTxn = await optimisticOracle.methods
      .settle(optimisticRequester.options.address, identifier, requestTime, alternativeAncillaryData)
      .send({ from: owner });
    await eventClient.update();
    await contractMonitor.checkForSettlements();
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.transactionHash}`));
    // Proposal this time was not disputed so payout to the proposer.
    // Proposer reward equals: default bond (2x final fee) + proposal reward
    // = (2 * 1) + 3 = 5
    assert.isTrue(lastSpyLogIncludes(spy, "payout was 5.00 made to the proposer"));
    // Check that only one extra event was emitted since we already "checked" the original events.
    assert.equal(spy.callCount, spyCount + 1);
  });
  it("Can correctly create contract monitor with no config provided", async function () {
    let errorThrown;
    try {
      // Create an invalid config. A valid config expects two arrays of addresses.
      contractMonitor = new OptimisticOracleContractMonitor({
        logger: spyLogger,
        optimisticOracleContractEventClient: eventClient,
        monitorConfig: {},
        contractProps,
      });
      await contractMonitor.checkForRequests();
      await contractMonitor.checkForProposals();
      await contractMonitor.checkForDisputes();
      await contractMonitor.checkForSettlements();
      errorThrown = false;
    } catch (err) {
      errorThrown = true;
    }
    assert.isFalse(errorThrown);
  });
  describe("SkinnyOptimisticOracle", function () {
    it("Winston correctly emits price request message", async function () {
      await skinnyEventClient.update();
      await skinnyContractMonitor.checkForRequests();

      assert.equal(lastSpyLogLevel(spy), "error");

      // Should contain etherscan addresses for the requester and transaction
      assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${requester}`));
      assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${skinnyRequestTxn.transactionHash}`));

      // should contain the correct request information.
      assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
      assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
      assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
      assert.isTrue(lastSpyLogIncludes(spy, collateral.options.address)); // Currency
      assert.isTrue(lastSpyLogIncludes(spy, "3.00")); // Reward, formatted correctly
      assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // Final Fee
      let spyCount = spy.callCount;

      // Make another request with different ancillary data.
      const newTxn = await skinnyOptimisticOracle.methods
        .requestPrice(
          identifier,
          requestTime,
          alternativeAncillaryData,
          collateral.options.address,
          reward,
          finalFee,
          0
        )
        .send({ from: requester });
      await skinnyEventClient.update();
      await skinnyContractMonitor.checkForRequests();
      assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.transactionHash}`));
      assert.isTrue(lastSpyLogIncludes(spy, alternativeAncillaryData)); // Ancillary Data

      // Check that only one extra event was emitted since we already "checked" the original events.
      assert.equal(spy.callCount, spyCount + 1);
    });
    it("Winston correctly emits price proposal message", async function () {
      await skinnyEventClient.update();
      await skinnyContractMonitor.checkForProposals();

      assert.equal(lastSpyLogLevel(spy), "error");

      // Should contain etherscan addresses for the proposer and transaction
      assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${skinnyProposer}`));
      assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${skinnyProposalTxn.transactionHash}`));

      // should contain the correct proposal information.
      assert.isTrue(lastSpyLogIncludes(spy, requester)); // Requester
      assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
      assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
      assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
      assert.isTrue(lastSpyLogIncludes(spy, collateral.options.address)); // Currency
      assert.isTrue(lastSpyLogIncludes(spy, "-17.00")); // Proposed Price
      assert.isTrue(lastSpyLogIncludes(spy, (Number(proposalTime) + liveness).toString())); // Expiration time
      let spyCount = spy.callCount;

      // Make another proposal with different ancillary data.
      await skinnyOptimisticOracle.methods
        .requestPrice(
          identifier,
          requestTime,
          alternativeAncillaryData,
          collateral.options.address,
          reward,
          finalFee,
          0
        )
        .send({ from: requester });
      const latestRequestEvent = (await skinnyOptimisticOracle.getPastEvents("RequestPrice", { fromBlock: 0 })).slice(
        -1
      )[0];
      const newTxn = await skinnyOptimisticOracle.methods
        .proposePrice(
          requester,
          identifier,
          requestTime,
          alternativeAncillaryData,
          latestRequestEvent.returnValues.request,
          correctPrice
        )
        .send({ from: skinnyProposer });
      await skinnyEventClient.update();
      await skinnyContractMonitor.checkForProposals();
      assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.transactionHash}`));
      assert.isTrue(lastSpyLogIncludes(spy, alternativeAncillaryData)); // Ancillary Data

      // Check that only one extra event was emitted since we already "checked" the original events.
      assert.equal(spy.callCount, spyCount + 1);
    });
    it("Winston correctly emits price dispute message", async function () {
      await skinnyEventClient.update();
      await skinnyContractMonitor.checkForDisputes();

      assert.equal(lastSpyLogLevel(spy), "error");

      // Should contain etherscan addresses for the disputer and transaction
      assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${disputer}`));
      assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${skinnyDisputeTxn.transactionHash}`));

      // should contain the correct dispute information.
      assert.isTrue(lastSpyLogIncludes(spy, requester)); // Requester
      assert.isTrue(lastSpyLogIncludes(spy, skinnyProposer)); // Proposer
      assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
      assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
      assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
      assert.isTrue(lastSpyLogIncludes(spy, "-17.00")); // Proposed Price
      let spyCount = spy.callCount;

      // Make another dispute with different ancillary data.
      await skinnyOptimisticOracle.methods
        .requestPrice(
          identifier,
          requestTime,
          alternativeAncillaryData,
          collateral.options.address,
          reward,
          finalFee,
          0
        )
        .send({ from: requester });
      const latestRequestEvent = (await skinnyOptimisticOracle.getPastEvents("RequestPrice", { fromBlock: 0 })).slice(
        -1
      )[0];
      await skinnyOptimisticOracle.methods
        .proposePrice(
          requester,
          identifier,
          requestTime,
          alternativeAncillaryData,
          latestRequestEvent.returnValues.request,
          correctPrice
        )
        .send({ from: skinnyProposer });
      const latestProposalEvent = (await skinnyOptimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 })).slice(
        -1
      )[0];
      const newTxn = await skinnyOptimisticOracle.methods
        .disputePrice(
          requester,
          identifier,
          requestTime,
          alternativeAncillaryData,
          latestProposalEvent.returnValues.request
        )
        .send({ from: disputer });
      await skinnyEventClient.update();
      await skinnyContractMonitor.checkForDisputes();
      assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.transactionHash}`));
      assert.isTrue(lastSpyLogIncludes(spy, alternativeAncillaryData)); // Ancillary Data

      // Check that only one extra event was emitted since we already "checked" the original events.
      assert.equal(spy.callCount, spyCount + 1);
    });
    it("Winston correctly emits price settlement message", async function () {
      await skinnyEventClient.update();
      await skinnyContractMonitor.checkForSettlements();

      assert.equal(lastSpyLogLevel(spy), "info");

      // Should contain etherscan addresses for the transaction
      assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${skinnySettlementTxn.transactionHash}`));

      // should contain the correct settlement information.
      assert.isTrue(lastSpyLogIncludes(spy, requester)); // Requester
      assert.isTrue(lastSpyLogIncludes(spy, skinnyProposer)); // Proposer
      assert.isTrue(lastSpyLogIncludes(spy, disputer)); // Disputer
      assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
      assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
      assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
      assert.isTrue(lastSpyLogIncludes(spy, "17.00")); // Price
      // Proposal was disputed, payout made to winner of disputer
      // Dispute reward equals: default bond (2x final fee) + proposal reward + 1/2 of loser's final fee
      // = (2 * 1) + 3 + (0.5 * 1) = 5.5
      assert.isTrue(lastSpyLogIncludes(spy, "payout was 5.50 made to the winner of the dispute"));
      let spyCount = spy.callCount;

      // Make another settlement without a dispute, with different ancillary data.
      await skinnyOptimisticOracle.methods
        .requestPrice(
          identifier,
          requestTime,
          alternativeAncillaryData,
          collateral.options.address,
          reward,
          finalFee,
          0
        )
        .send({ from: requester });
      const newProposalTime = await skinnyOptimisticOracle.methods.getCurrentTime().call();
      const latestRequestEvent = (await skinnyOptimisticOracle.getPastEvents("RequestPrice", { fromBlock: 0 })).slice(
        -1
      )[0];
      await skinnyOptimisticOracle.methods
        .proposePrice(
          requester,
          identifier,
          requestTime,
          alternativeAncillaryData,
          latestRequestEvent.returnValues.request,
          correctPrice
        )
        .send({ from: skinnyProposer });
      await skinnyOptimisticOracle.methods
        .setCurrentTime((Number(newProposalTime) + liveness).toString())
        .send({ from: owner });
      const latestProposalEvent = (await skinnyOptimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 })).slice(
        -1
      )[0];
      const newTxn = await skinnyOptimisticOracle.methods
        .settle(requester, identifier, requestTime, alternativeAncillaryData, latestProposalEvent.returnValues.request)
        .send({ from: owner });
      await skinnyEventClient.update();
      await skinnyContractMonitor.checkForSettlements();
      assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.transactionHash}`));
      // Proposal this time was not disputed so payout to the proposer.
      // Proposer reward equals: default bond (2x final fee) + proposal reward
      // = (2 * 1) + 3 = 5
      assert.isTrue(lastSpyLogIncludes(spy, "payout was 5.00 made to the proposer"));
      // Check that only one extra event was emitted since we already "checked" the original events.
      assert.equal(spy.callCount, spyCount + 1);
    });
  });
});
