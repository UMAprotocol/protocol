const winston = require("winston");
const sinon = require("sinon");

const { toWei, hexToUtf8, utf8ToHex, toBN } = web3.utils;

const { OptimisticOracleContractMonitor } = require("../src/OptimisticOracleContractMonitor");
const { interfaceName, MAX_UINT_VAL } = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

const {
  OptimisticOracleEventClient,
  SpyTransport,
  lastSpyLogIncludes,
  lastSpyLogLevel
} = require("@uma/financial-templates-lib");

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

contract("OptimisticOracleContractMonitor.js", function(accounts) {
  const owner = accounts[0];
  const requester = accounts[1];
  const proposer = accounts[2];
  const disputer = accounts[3];

  let optimisticRequester;
  let optimisticOracle;
  let eventClient;
  let contractMonitor;
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
  // Proposal & Dispute bond = 2 x final fee
  const totalDefaultBond = toBN(finalFee)
    .mul(toBN(2))
    .toString(); // 2x final fee
  const proposalPayout = toBN(totalDefaultBond)
    .add(toBN(reward))
    .toString(); // dispute bond + reward
  const disputePayout = toBN(totalDefaultBond)
    .add(toBN(reward))
    .add(toBN(finalFee).div(toBN(2)))
    .toString(); // dispute bond + reward +  50% of loser's bond
  const correctPrice = toWei("-17"); // Arbitrary price to use as the correct price for proposals + disputes
  const identifier = web3.utils.utf8ToHex("Test Identifier");
  const defaultAncillaryData = "0x";
  const alternativeAncillaryData = "0x1234";

  const pushPrice = async price => {
    const [lastQuery] = (await mockOracle.getPendingQueries()).slice(-1);
    await mockOracle.pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price);
  };

  before(async function() {
    finder = await Finder.new();
    timer = await Timer.new();

    // Whitelist an initial identifier we can use to make default price requests.
    identifierWhitelist = await IdentifierWhitelist.new();
    await identifierWhitelist.addSupportedIdentifier(identifier);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.address);

    collateralWhitelist = await AddressWhitelist.new();
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.address);

    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Store), store.address);

    mockOracle = await MockOracle.new(finder.address, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.address);
  });

  let requestTxn, proposalTxn, disputeTxn, settlementTxn;
  beforeEach(async function() {
    // Deploy and whitelist a new collateral currency that we will use to pay oracle fees.
    collateral = await Token.new("Wrapped Ether", "WETH", 18);
    await collateral.addMember(1, owner);
    await collateral.mint(owner, initialUserBalance);
    await collateral.mint(proposer, initialUserBalance);
    await collateral.mint(requester, initialUserBalance);
    await collateral.mint(disputer, initialUserBalance);
    await collateralWhitelist.addToWhitelist(collateral.address);

    // Set a non-0 final fee for the collateral currency.
    await store.setFinalFee(collateral.address, { rawValue: finalFee });

    optimisticOracle = await OptimisticOracle.new(liveness, finder.address, timer.address);

    // Contract used to make price requests. Mint it some collateral to pay rewards with.
    optimisticRequester = await OptimisticRequesterTest.new(optimisticOracle.address);
    await collateral.mint(optimisticRequester.address, initialUserBalance);

    startTime = (await optimisticOracle.getCurrentTime()).toNumber();
    requestTime = startTime - 10;

    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston
    // logs the correct text based on interactions with the OptimisticOracle contract. Note that only `info` level messages are captured.
    spy = sinon.spy();
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy })]
    });

    eventClient = new OptimisticOracleEventClient(
      spyLogger,
      OptimisticOracle.abi,
      web3,
      optimisticOracle.address,
      0, // startingBlockNumber
      null // endingBlockNumber
    );

    monitorConfig = {};
    contractProps = {
      networkId: await web3.eth.net.getId()
    };

    contractMonitor = new OptimisticOracleContractMonitor({
      logger: spyLogger,
      optimisticOracleContractEventClient: eventClient,
      monitorConfig,
      contractProps
    });

    // Make price requests
    requestTxn = await optimisticRequester.requestPrice(
      identifier,
      requestTime,
      defaultAncillaryData,
      collateral.address,
      reward
    );

    // Make proposals
    await collateral.approve(optimisticOracle.address, MAX_UINT_VAL, { from: proposer });
    proposalTime = await optimisticOracle.getCurrentTime();
    proposalTxn = await optimisticOracle.proposePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      defaultAncillaryData,
      correctPrice,
      {
        from: proposer
      }
    );

    // Make disputes and resolve them
    await collateral.approve(optimisticOracle.address, MAX_UINT_VAL, { from: disputer });
    disputeTxn = await optimisticOracle.disputePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      defaultAncillaryData,
      {
        from: disputer
      }
    );
    await pushPrice(correctPrice);

    // Settle expired proposals and resolved disputes
    settlementTxn = await optimisticOracle.settle(
      optimisticRequester.address,
      identifier,
      requestTime,
      defaultAncillaryData
    );
  });

  it("Winston correctly emits price request message", async function() {
    await eventClient.update();
    await contractMonitor.checkForRequests();

    assert.equal(lastSpyLogLevel(spy), "error");

    // Should contain etherscan addresses for the requester and transaction
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${optimisticRequester.address}`));
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${requestTxn.tx}`));

    // should contain the correct request information.
    assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
    assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
    assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
    assert.isTrue(lastSpyLogIncludes(spy, collateral.address)); // Currency
    assert.isTrue(lastSpyLogIncludes(spy, reward)); // Reward
    assert.isTrue(lastSpyLogIncludes(spy, finalFee)); // Final Fee
    let spyCount = spy.callCount;

    // Make another request with different ancillary data.
    const newTxn = await optimisticRequester.requestPrice(
      identifier,
      requestTime,
      alternativeAncillaryData,
      collateral.address,
      reward
    );
    await eventClient.update();
    await contractMonitor.checkForRequests();
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.tx}`));
    assert.isTrue(lastSpyLogIncludes(spy, alternativeAncillaryData)); // Ancillary Data

    // Check that only one extra event was emitted since we already "checked" the original events.
    assert.equal(spy.callCount, spyCount + 1);
  });
  it("Winston correctly emits price proposal message", async function() {
    await eventClient.update();
    await contractMonitor.checkForProposals();

    assert.equal(lastSpyLogLevel(spy), "error");

    // Should contain etherscan addresses for the proposer and transaction
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${proposer}`));
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${proposalTxn.tx}`));

    // should contain the correct proposal information.
    assert.isTrue(lastSpyLogIncludes(spy, optimisticRequester.address)); // Requester
    assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
    assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
    assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
    assert.isTrue(lastSpyLogIncludes(spy, collateral.address)); // Currency
    assert.isTrue(lastSpyLogIncludes(spy, correctPrice)); // Proposed Price
    assert.isTrue(lastSpyLogIncludes(spy, (Number(proposalTime) + liveness).toString())); // Expiration time
    let spyCount = spy.callCount;

    // Make another proposal with different ancillary data.
    await optimisticRequester.requestPrice(
      identifier,
      requestTime,
      alternativeAncillaryData,
      collateral.address,
      reward
    );
    const newTxn = await optimisticOracle.proposePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      alternativeAncillaryData,
      correctPrice,
      {
        from: proposer
      }
    );
    await eventClient.update();
    await contractMonitor.checkForProposals();
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.tx}`));
    assert.isTrue(lastSpyLogIncludes(spy, alternativeAncillaryData)); // Ancillary Data

    // Check that only one extra event was emitted since we already "checked" the original events.
    assert.equal(spy.callCount, spyCount + 1);
  });
  it("Winston correctly emits price dispute message", async function() {
    await eventClient.update();
    await contractMonitor.checkForDisputes();

    assert.equal(lastSpyLogLevel(spy), "error");

    // Should contain etherscan addresses for the disputer and transaction
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/address/${disputer}`));
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${disputeTxn.tx}`));

    // should contain the correct dispute information.
    assert.isTrue(lastSpyLogIncludes(spy, optimisticRequester.address)); // Requester
    assert.isTrue(lastSpyLogIncludes(spy, proposer)); // Proposer
    assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
    assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
    assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
    assert.isTrue(lastSpyLogIncludes(spy, correctPrice)); // Proposed Price
    let spyCount = spy.callCount;

    // Make another dispute with different ancillary data.
    await optimisticRequester.requestPrice(
      identifier,
      requestTime,
      alternativeAncillaryData,
      collateral.address,
      reward
    );
    await optimisticOracle.proposePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      alternativeAncillaryData,
      correctPrice,
      {
        from: proposer
      }
    );
    const newTxn = await optimisticOracle.disputePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      alternativeAncillaryData,
      {
        from: disputer
      }
    );
    await eventClient.update();
    await contractMonitor.checkForDisputes();
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.tx}`));
    assert.isTrue(lastSpyLogIncludes(spy, alternativeAncillaryData)); // Ancillary Data

    // Check that only one extra event was emitted since we already "checked" the original events.
    assert.equal(spy.callCount, spyCount + 1);
  });
  it("Winston correctly emits price settlement message", async function() {
    await eventClient.update();
    await contractMonitor.checkForSettlements();

    assert.equal(lastSpyLogLevel(spy), "info");

    // Should contain etherscan addresses for the transaction
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${settlementTxn.tx}`));

    // should contain the correct settlement information.
    assert.isTrue(lastSpyLogIncludes(spy, optimisticRequester.address)); // Requester
    assert.isTrue(lastSpyLogIncludes(spy, proposer)); // Proposer
    assert.isTrue(lastSpyLogIncludes(spy, disputer)); // Disputer
    assert.isTrue(lastSpyLogIncludes(spy, hexToUtf8(identifier))); // Identifier
    assert.isTrue(lastSpyLogIncludes(spy, requestTime)); // Timestamp
    assert.isTrue(lastSpyLogIncludes(spy, defaultAncillaryData)); // Ancillary Data
    assert.isTrue(lastSpyLogIncludes(spy, correctPrice)); // Price
    // Proposal was disputed, payout made to winner of disputer
    assert.isTrue(lastSpyLogIncludes(spy, `payout was ${disputePayout} made to the winner of the dispute`));
    let spyCount = spy.callCount;

    // Make another settlement without a dispute, with different ancillary data.
    await optimisticRequester.requestPrice(
      identifier,
      requestTime,
      alternativeAncillaryData,
      collateral.address,
      reward
    );
    const newProposalTime = await optimisticOracle.getCurrentTime();
    await optimisticOracle.proposePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      alternativeAncillaryData,
      correctPrice,
      {
        from: proposer
      }
    );
    await optimisticOracle.setCurrentTime((Number(newProposalTime) + liveness).toString());
    const newTxn = await optimisticOracle.settle(
      optimisticRequester.address,
      identifier,
      requestTime,
      alternativeAncillaryData
    );
    await eventClient.update();
    await contractMonitor.checkForSettlements();
    assert.isTrue(lastSpyLogIncludes(spy, `https://etherscan.io/tx/${newTxn.tx}`));
    // Proposal this time was not disputed so payout to the proposer.
    assert.isTrue(lastSpyLogIncludes(spy, `payout was ${proposalPayout} made to the proposer`));
    // Check that only one extra event was emitted since we already "checked" the original events.
    assert.equal(spy.callCount, spyCount + 1);
  });
  it("Can correctly create contract monitor with no config provided", async function() {
    let errorThrown;
    try {
      // Create an invalid config. A valid config expects two arrays of addresses.
      contractMonitor = new OptimisticOracleContractMonitor({
        logger: spyLogger,
        optimisticOracleContractEventClient: eventClient,
        monitorConfig: {},
        contractProps
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
});
