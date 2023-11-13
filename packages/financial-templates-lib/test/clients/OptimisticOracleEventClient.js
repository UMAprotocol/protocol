const { web3, getContract } = require("hardhat");
const { assert } = require("chai");

const winston = require("winston");
const sinon = require("sinon");
const { SpyTransport } = require("@uma/logger");

const { toWei, hexToUtf8, utf8ToHex, toBN } = web3.utils;

const { OptimisticOracleEventClient } = require("../../dist/clients/OptimisticOracleEventClient");
const { OptimisticOracleType } = require("../../dist/clients/OptimisticOracleClient");
const { interfaceName, advanceBlockAndSetTime, MAX_UINT_VAL, ZERO_ADDRESS } = require("@uma/common");

const SkinnyOptimisticOracle = getContract("SkinnyOptimisticOracle");
const OptimisticOracle = getContract("OptimisticOracle");
const OptimisticOracleV2 = getContract("OptimisticOracleV2");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Token = getContract("ExpandedERC20");
const AddressWhitelist = getContract("AddressWhitelist");
const Timer = getContract("Timer");
const Store = getContract("Store");
const MockOracle = getContract("MockOracleAncillary");

const objectsInArrayInclude = (superset, subset) => {
  assert.equal(superset.length, subset.length);
  for (let i = 0; i < superset.length; i++) assert.deepInclude(superset[i], subset[i]);
};

describe("OptimisticOracleEventClient.js", function () {
  // Note: We have separate requesters for different OO's so that the ancillary data for their price requests
  // are different. Requester address is included in ancillary data when the OO requests a price from the Oracle.
  let owner, requester, skinnyRequester, proposer, disputer, accounts;

  // Contracts
  let optimisticOracle;
  let optimisticOracleV2;
  let skinnyOptimisticOracle;
  let mockOracle;
  let finder;
  let timer;
  let identifierWhitelist;
  let collateralWhitelist;
  let store;
  let collateral;

  // Bot helper modules
  let client;
  let clientV2;
  let skinnyClient;
  let dummyLogger;
  let spy;

  // Timestamps that we'll use throughout the test.
  let requestTime;
  let startTime;
  let proposalTime;

  // Default testing values.
  const liveness = 7200; // 2 hours
  const initialUserBalance = toWei("100");
  const finalFee = toWei("1");
  const totalDefaultBond = toBN(finalFee).mul(toBN(2)).toString(); // 2x final fee
  const disputePayout = toBN(totalDefaultBond)
    .add(toBN(finalFee).div(toBN(2)))
    .toString(); // dispute bond + 50% of loser's bond
  const correctPrice = toWei("-17"); // Arbitrary price to use as the correct price for proposals + disputes
  const identifier = web3.utils.utf8ToHex("Test Identifier");
  const defaultAncillaryData = "0x";

  const pushPrice = async (price) => {
    const [lastQuery] = (await mockOracle.methods.getPendingQueries().call()).slice(-1);
    await mockOracle.methods
      .pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price)
      .send({ from: accounts[0] });
  };

  // Helper function to get the log index of a given event name in a transaction.
  const getLogIndex = (txn, eventName, abi) => {
    const signature = abi.find((i) => i.type === "event" && i.name === eventName).signature;
    const eventKey = Object.keys(txn.events).find((key) => txn.events[key].raw.topics[0] === signature);
    return txn.events[eventKey].logIndex;
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, requester, skinnyRequester, proposer, disputer] = accounts;

    finder = await Finder.new().send({ from: accounts[0] });
    timer = await Timer.new().send({ from: accounts[0] });

    // Whitelist an initial identifier we can use to make default price requests.
    identifierWhitelist = await IdentifierWhitelist.new().send({ from: accounts[0] });
    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: accounts[0] });

    collateralWhitelist = await AddressWhitelist.new().send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: accounts[0] });

    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: accounts[0] });
  });

  let requestTxn1, requestTxn2, proposalTxn1, proposalTxn2, disputeTxn1, disputeTxn2, settlementTxn1, settlementTxn2;

  let requestLogIndex1,
    requestLogIndex2,
    proposalLogIndex1,
    proposalLogIndex2,
    disputeLogIndex1,
    disputeLogIndex2,
    settlementLogIndex1,
    settlementLogIndex2;

  let requestV2Txn1,
    requestV2Txn2,
    proposalV2Txn1,
    proposalV2Txn2,
    disputeV2Txn1,
    disputeV2Txn2,
    settlementV2Txn1,
    settlementV2Txn2;

  let requestV2LogIndex1,
    requestV2LogIndex2,
    proposalV2LogIndex1,
    proposalV2LogIndex2,
    disputeV2LogIndex1,
    disputeV2LogIndex2,
    settlementV2LogIndex1,
    settlementV2LogIndex2;

  let skinnyRequestTxn1,
    skinnyRequestTxn2,
    skinnyProposalTxn1,
    skinnyProposalTxn2,
    skinnyDisputeTxn1,
    skinnyDisputeTxn2,
    skinnySettlementTxn1,
    skinnySettlementTxn2;

  let skinnyRequestLogIndex1,
    skinnyRequestLogIndex2,
    skinnyProposalLogIndex1,
    skinnyProposalLogIndex2,
    skinnyDisputeLogIndex1,
    skinnyDisputeLogIndex2,
    skinnySettlementLogIndex1,
    skinnySettlementLogIndex2;

  let requestEvents, proposeEvents, disputeEvents, settleEvents;
  beforeEach(async function () {
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: accounts[0] });

    // Deploy and whitelist a new collateral currency that we will use to pay oracle fees.
    collateral = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] });
    await collateral.methods.addMember(1, owner).send({ from: accounts[0] });
    await collateral.methods.mint(owner, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(proposer, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(requester, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(skinnyRequester, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(disputer, initialUserBalance).send({ from: accounts[0] });
    await collateralWhitelist.methods.addToWhitelist(collateral.options.address).send({ from: accounts[0] });

    // Set a non-0 final fee for the collateral currency.
    await store.methods.setFinalFee(collateral.options.address, { rawValue: finalFee }).send({ from: accounts[0] });

    optimisticOracle = await OptimisticOracle.new(liveness, finder.options.address, timer.options.address).send({
      from: accounts[0],
    });
    optimisticOracleV2 = await OptimisticOracleV2.new(liveness, finder.options.address, timer.options.address).send({
      from: accounts[0],
    });
    skinnyOptimisticOracle = await SkinnyOptimisticOracle.new(
      liveness,
      finder.options.address,
      timer.options.address
    ).send({ from: accounts[0] });

    startTime = parseInt(await timer.methods.getCurrentTime().call());
    requestTime = startTime - 10;

    // The OptimisticOracleEventClient does not emit any info `level` events. DummyLogger will not print anything
    // to console as only capture `info` level events. The spy logger is used to test for `debug` level events.
    dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });
    spy = sinon.spy();

    client = new OptimisticOracleEventClient(
      winston.createLogger({ level: "debug", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
      OptimisticOracle.abi,
      web3,
      optimisticOracle.options.address,
      OptimisticOracleType.OptimisticOracle,
      0, // startingBlockNumber
      null // endingBlockNumber
    );

    clientV2 = new OptimisticOracleEventClient(
      winston.createLogger({ level: "debug", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
      OptimisticOracle.abi,
      web3,
      optimisticOracleV2.options.address,
      OptimisticOracleType.OptimisticOracleV2,
      0, // startingBlockNumber
      null // endingBlockNumber
    );

    skinnyClient = new OptimisticOracleEventClient(
      winston.createLogger({ level: "debug", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
      SkinnyOptimisticOracle.abi,
      web3,
      skinnyOptimisticOracle.options.address,
      OptimisticOracleType.SkinnyOptimisticOracle,
      0, // startingBlockNumber
      null // endingBlockNumber
    );

    // Make price requests
    requestTxn1 = await optimisticOracle.methods
      .requestPrice(identifier, requestTime, defaultAncillaryData, collateral.options.address, 0)
      .send({ from: requester });
    requestLogIndex1 = getLogIndex(requestTxn1, "RequestPrice", OptimisticOracle.abi);
    requestTxn2 = await optimisticOracle.methods
      .requestPrice(identifier, requestTime + 1, defaultAncillaryData, collateral.options.address, 0)
      .send({ from: requester });
    requestLogIndex2 = getLogIndex(requestTxn2, "RequestPrice", OptimisticOracle.abi);

    requestV2Txn1 = await optimisticOracleV2.methods
      .requestPrice(identifier, requestTime + 2, defaultAncillaryData, collateral.options.address, 0)
      .send({ from: requester });
    requestV2LogIndex1 = getLogIndex(requestV2Txn1, "RequestPrice", OptimisticOracleV2.abi);
    requestV2Txn2 = await optimisticOracleV2.methods
      .requestPrice(identifier, requestTime + 3, defaultAncillaryData, collateral.options.address, 0)
      .send({ from: requester });
    requestV2LogIndex2 = getLogIndex(requestV2Txn2, "RequestPrice", OptimisticOracleV2.abi);

    skinnyRequestTxn1 = await skinnyOptimisticOracle.methods
      .requestPrice(identifier, requestTime, defaultAncillaryData, collateral.options.address, 0, finalFee, 0)
      .send({ from: skinnyRequester });
    skinnyRequestLogIndex1 = getLogIndex(skinnyRequestTxn1, "RequestPrice", SkinnyOptimisticOracle.abi);
    skinnyRequestTxn2 = await skinnyOptimisticOracle.methods
      .requestPrice(identifier, requestTime + 1, defaultAncillaryData, collateral.options.address, 0, finalFee, 0)
      .send({ from: skinnyRequester });
    skinnyRequestLogIndex2 = getLogIndex(skinnyRequestTxn2, "RequestPrice", SkinnyOptimisticOracle.abi);

    // Make proposals
    await collateral.methods.approve(optimisticOracle.options.address, MAX_UINT_VAL).send({ from: proposer });
    await collateral.methods.approve(optimisticOracleV2.options.address, MAX_UINT_VAL).send({ from: proposer });
    await collateral.methods.approve(skinnyOptimisticOracle.options.address, MAX_UINT_VAL).send({ from: proposer });
    requestEvents = await skinnyOptimisticOracle.getPastEvents("RequestPrice", { fromBlock: 0 });
    proposalTime = await optimisticOracle.methods.getCurrentTime().call();

    proposalTxn1 = await optimisticOracle.methods
      .proposePrice(requester, identifier, requestTime, defaultAncillaryData, correctPrice)
      .send({ from: proposer });
    proposalLogIndex1 = getLogIndex(proposalTxn1, "ProposePrice", OptimisticOracle.abi);
    proposalTxn2 = await optimisticOracle.methods
      .proposePrice(requester, identifier, requestTime + 1, defaultAncillaryData, correctPrice)
      .send({ from: proposer });
    proposalLogIndex2 = getLogIndex(proposalTxn2, "ProposePrice", OptimisticOracle.abi);

    proposalV2Txn1 = await optimisticOracleV2.methods
      .proposePrice(requester, identifier, requestTime + 2, defaultAncillaryData, correctPrice)
      .send({ from: proposer });
    proposalV2LogIndex1 = getLogIndex(proposalV2Txn1, "ProposePrice", OptimisticOracleV2.abi);
    proposalV2Txn2 = await optimisticOracleV2.methods
      .proposePrice(requester, identifier, requestTime + 3, defaultAncillaryData, correctPrice)
      .send({ from: proposer });
    proposalV2LogIndex2 = getLogIndex(proposalV2Txn2, "ProposePrice", OptimisticOracleV2.abi);

    skinnyProposalTxn1 = await skinnyOptimisticOracle.methods
      .proposePrice(
        skinnyRequester,
        identifier,
        requestTime,
        defaultAncillaryData,
        requestEvents[0].returnValues.request,
        correctPrice
      )
      .send({ from: proposer });
    skinnyProposalLogIndex1 = getLogIndex(skinnyProposalTxn1, "ProposePrice", SkinnyOptimisticOracle.abi);
    skinnyProposalTxn2 = await skinnyOptimisticOracle.methods
      .proposePrice(
        skinnyRequester,
        identifier,
        requestTime + 1,
        defaultAncillaryData,
        requestEvents[1].returnValues.request,
        correctPrice
      )
      .send({ from: proposer });
    skinnyProposalLogIndex2 = getLogIndex(skinnyProposalTxn2, "ProposePrice", SkinnyOptimisticOracle.abi);

    // Make disputes and resolve them
    await collateral.methods.approve(optimisticOracle.options.address, MAX_UINT_VAL).send({ from: disputer });
    await collateral.methods.approve(optimisticOracleV2.options.address, MAX_UINT_VAL).send({ from: disputer });
    await collateral.methods.approve(skinnyOptimisticOracle.options.address, MAX_UINT_VAL).send({ from: disputer });
    proposeEvents = await skinnyOptimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 });
    disputeTxn1 = await optimisticOracle.methods
      .disputePrice(requester, identifier, requestTime, defaultAncillaryData)
      .send({ from: disputer });
    disputeLogIndex1 = getLogIndex(disputeTxn1, "DisputePrice", OptimisticOracle.abi);
    await pushPrice(correctPrice);
    disputeTxn2 = await optimisticOracle.methods
      .disputePrice(requester, identifier, requestTime + 1, defaultAncillaryData)
      .send({ from: disputer });
    disputeLogIndex2 = getLogIndex(disputeTxn2, "DisputePrice", OptimisticOracle.abi);
    await pushPrice(correctPrice);

    disputeV2Txn1 = await optimisticOracleV2.methods
      .disputePrice(requester, identifier, requestTime + 2, defaultAncillaryData)
      .send({ from: disputer });
    disputeV2LogIndex1 = getLogIndex(disputeV2Txn1, "DisputePrice", OptimisticOracleV2.abi);
    await pushPrice(correctPrice);
    disputeV2Txn2 = await optimisticOracleV2.methods
      .disputePrice(requester, identifier, requestTime + 3, defaultAncillaryData)
      .send({ from: disputer });
    disputeV2LogIndex2 = getLogIndex(disputeV2Txn2, "DisputePrice", OptimisticOracleV2.abi);
    await pushPrice(correctPrice);

    skinnyDisputeTxn1 = await skinnyOptimisticOracle.methods
      .disputePrice(
        skinnyRequester,
        identifier,
        requestTime,
        defaultAncillaryData,
        proposeEvents[0].returnValues.request
      )
      .send({ from: disputer });
    skinnyDisputeLogIndex1 = getLogIndex(skinnyDisputeTxn1, "DisputePrice", SkinnyOptimisticOracle.abi);
    await pushPrice(correctPrice);
    skinnyDisputeTxn2 = await skinnyOptimisticOracle.methods
      .disputePrice(
        skinnyRequester,
        identifier,
        requestTime + 1,
        defaultAncillaryData,
        proposeEvents[1].returnValues.request
      )
      .send({ from: disputer });
    skinnyDisputeLogIndex2 = getLogIndex(skinnyDisputeTxn2, "DisputePrice", SkinnyOptimisticOracle.abi);
    await pushPrice(correctPrice);

    // Settle expired proposals and resolved disputes
    disputeEvents = await skinnyOptimisticOracle.getPastEvents("DisputePrice", { fromBlock: 0 });
    settlementTxn1 = await optimisticOracle.methods
      .settle(requester, identifier, requestTime, defaultAncillaryData)
      .send({ from: accounts[0] });
    settlementLogIndex1 = getLogIndex(settlementTxn1, "Settle", OptimisticOracle.abi);
    settlementTxn2 = await optimisticOracle.methods
      .settle(requester, identifier, requestTime + 1, defaultAncillaryData)
      .send({ from: accounts[0] });
    settlementLogIndex2 = getLogIndex(settlementTxn2, "Settle", OptimisticOracle.abi);

    settlementV2Txn1 = await optimisticOracleV2.methods
      .settle(requester, identifier, requestTime + 2, defaultAncillaryData)
      .send({ from: accounts[0] });
    settlementV2LogIndex1 = getLogIndex(settlementV2Txn1, "Settle", OptimisticOracleV2.abi);
    settlementV2Txn2 = await optimisticOracleV2.methods
      .settle(requester, identifier, requestTime + 3, defaultAncillaryData)
      .send({ from: accounts[0] });
    settlementV2LogIndex2 = getLogIndex(settlementV2Txn2, "Settle", OptimisticOracleV2.abi);

    skinnySettlementTxn1 = await skinnyOptimisticOracle.methods
      .settle(skinnyRequester, identifier, requestTime, defaultAncillaryData, disputeEvents[0].returnValues.request)
      .send({ from: accounts[0] });
    skinnySettlementLogIndex1 = getLogIndex(skinnySettlementTxn1, "Settle", SkinnyOptimisticOracle.abi);
    skinnySettlementTxn2 = await skinnyOptimisticOracle.methods
      .settle(skinnyRequester, identifier, requestTime + 1, defaultAncillaryData, disputeEvents[1].returnValues.request)
      .send({ from: accounts[0] });
    skinnySettlementLogIndex2 = getLogIndex(skinnySettlementTxn2, "Settle", SkinnyOptimisticOracle.abi);

    settleEvents = await skinnyOptimisticOracle.getPastEvents("Settle", { fromBlock: 0 });
  });

  it("Return RequestPrice events", async function () {
    await client.clearState();
    // State is empty before update().
    objectsInArrayInclude([], client.getAllRequestPriceEvents());
    await client.update();

    objectsInArrayInclude(client.getAllRequestPriceEvents(), [
      {
        transactionHash: requestTxn1.transactionHash,
        blockNumber: requestTxn1.blockNumber,
        logIndex: requestLogIndex1,
        requester: requester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        currency: collateral.options.address,
        reward: "0",
        finalFee,
      },
      {
        transactionHash: requestTxn2.transactionHash,
        blockNumber: requestTxn2.blockNumber,
        logIndex: requestLogIndex2,
        requester: requester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        currency: collateral.options.address,
        reward: "0",
        finalFee,
      },
    ]);

    // Correctly adds only new events after last query
    const newTxn = await optimisticOracle.methods
      .requestPrice(
        identifier,
        requestTime,
        // Note: we're using collateral address as ancillary data here to test with more entropy.
        collateral.options.address,
        collateral.options.address,
        0
      )
      .send({ from: requester });
    const newLogIndex = getLogIndex(newTxn, "RequestPrice", OptimisticOracle.abi);
    await client.clearState();
    await client.update();
    objectsInArrayInclude(client.getAllRequestPriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: requester,
        identifier: hexToUtf8(identifier),
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        currency: collateral.options.address,
        reward: "0",
        finalFee,
      },
    ]);
  });
  it("Return OptimisticOracleV2 RequestPrice events", async function () {
    await clientV2.clearState();
    // State is empty before update().
    objectsInArrayInclude([], clientV2.getAllRequestPriceEvents());
    await clientV2.update();

    objectsInArrayInclude(clientV2.getAllRequestPriceEvents(), [
      {
        transactionHash: requestV2Txn1.transactionHash,
        blockNumber: requestV2Txn1.blockNumber,
        logIndex: requestV2LogIndex1,
        requester: requester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 2).toString(),
        currency: collateral.options.address,
        reward: "0",
        finalFee,
      },
      {
        transactionHash: requestV2Txn2.transactionHash,
        blockNumber: requestV2Txn2.blockNumber,
        logIndex: requestV2LogIndex2,
        requester: requester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 3).toString(),
        currency: collateral.options.address,
        reward: "0",
        finalFee,
      },
    ]);

    // Correctly adds only new events after last query
    const newTxn = await optimisticOracleV2.methods
      .requestPrice(
        identifier,
        requestTime,
        // Note: we're using collateral address as ancillary data here to test with more entropy.
        collateral.options.address,
        collateral.options.address,
        0
      )
      .send({ from: requester });
    const newLogIndex = getLogIndex(newTxn, "RequestPrice", OptimisticOracleV2.abi);
    await clientV2.clearState();
    await clientV2.update();
    objectsInArrayInclude(clientV2.getAllRequestPriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: requester,
        identifier: hexToUtf8(identifier),
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        currency: collateral.options.address,
        reward: "0",
        finalFee,
      },
    ]);
  });
  it("Return Skinny RequestPrice events", async function () {
    await skinnyClient.clearState();
    // State is empty before update().
    objectsInArrayInclude([], skinnyClient.getAllRequestPriceEvents());
    await skinnyClient.update();
    objectsInArrayInclude(skinnyClient.getAllRequestPriceEvents(), [
      {
        transactionHash: skinnyRequestTxn1.transactionHash,
        blockNumber: skinnyRequestTxn1.blockNumber,
        logIndex: skinnyRequestLogIndex1,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        request: requestEvents[0].returnValues.request,
      },
      {
        transactionHash: skinnyRequestTxn2.transactionHash,
        blockNumber: skinnyRequestTxn2.blockNumber,
        logIndex: skinnyRequestLogIndex2,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        request: requestEvents[1].returnValues.request,
      },
    ]);

    // Correctly adds only new events after last query
    const newTxn = await skinnyOptimisticOracle.methods
      .requestPrice(
        identifier,
        requestTime,
        // Note: we're using collateral address as ancillary data here to test with more entropy.
        collateral.options.address,
        collateral.options.address,
        0,
        finalFee,
        0
      )
      .send({ from: skinnyRequester });
    const newLogIndex = getLogIndex(newTxn, "RequestPrice", SkinnyOptimisticOracle.abi);
    const newRequestEvent = (await skinnyOptimisticOracle.getPastEvents("RequestPrice", { fromBlock: 0 })).slice(-1)[0];
    await skinnyClient.clearState();
    await skinnyClient.update();
    objectsInArrayInclude(skinnyClient.getAllRequestPriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        request: newRequestEvent.returnValues.request,
      },
    ]);
  });
  it("Return ProposePrice events", async function () {
    await client.clearState();
    // State is empty before update().
    objectsInArrayInclude([], client.getAllProposePriceEvents());
    await client.update();
    objectsInArrayInclude(client.getAllProposePriceEvents(), [
      {
        transactionHash: proposalTxn1.transactionHash,
        blockNumber: proposalTxn1.blockNumber,
        logIndex: proposalLogIndex1,
        requester: requester,
        proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        currency: collateral.options.address,
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(proposalTime) + liveness).toString(),
      },
      {
        transactionHash: proposalTxn2.transactionHash,
        blockNumber: proposalTxn2.blockNumber,
        logIndex: proposalLogIndex2,
        requester: requester,
        proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        currency: collateral.options.address,
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(proposalTime) + liveness).toString(),
      },
    ]);

    // Correctly adds only new events after last query
    await optimisticOracle.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0)
      .send({ from: requester });
    const newProposalTime = await optimisticOracle.methods.getCurrentTime().call();
    const newTxn = await optimisticOracle.methods
      .proposePrice(
        requester,
        identifier,
        requestTime,
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        collateral.options.address.toLowerCase(),
        correctPrice
      )
      .send({ from: proposer });
    const newLogIndex = getLogIndex(newTxn, "ProposePrice", OptimisticOracle.abi);
    await client.clearState();
    await client.update();
    objectsInArrayInclude(client.getAllProposePriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: requester,
        proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        currency: collateral.options.address,
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(newProposalTime) + liveness).toString(),
      },
    ]);
  });
  it("Return OptimisticOracleV2 ProposePrice events", async function () {
    await clientV2.clearState();
    // State is empty before update().
    objectsInArrayInclude([], clientV2.getAllProposePriceEvents());
    await clientV2.update();
    objectsInArrayInclude(clientV2.getAllProposePriceEvents(), [
      {
        transactionHash: proposalV2Txn1.transactionHash,
        blockNumber: proposalV2Txn1.blockNumber,
        logIndex: proposalV2LogIndex1,
        requester: requester,
        proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 2).toString(),
        currency: collateral.options.address,
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(proposalTime) + liveness).toString(),
      },
      {
        transactionHash: proposalV2Txn2.transactionHash,
        blockNumber: proposalV2Txn2.blockNumber,
        logIndex: proposalV2LogIndex2,
        requester: requester,
        proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 3).toString(),
        currency: collateral.options.address,
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(proposalTime) + liveness).toString(),
      },
    ]);

    // Correctly adds only new events after last query
    await optimisticOracleV2.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0)
      .send({ from: requester });
    const newProposalTime = await optimisticOracleV2.methods.getCurrentTime().call();
    const newTxn = await optimisticOracleV2.methods
      .proposePrice(
        requester,
        identifier,
        requestTime,
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        collateral.options.address.toLowerCase(),
        correctPrice
      )
      .send({ from: proposer });
    const newLogIndex = getLogIndex(newTxn, "ProposePrice", OptimisticOracleV2.abi);
    await clientV2.clearState();
    await clientV2.update();
    objectsInArrayInclude(clientV2.getAllProposePriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: requester,
        proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        currency: collateral.options.address,
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(newProposalTime) + liveness).toString(),
      },
    ]);
  });
  it("Return Skinny ProposePrice events", async function () {
    await skinnyClient.clearState();
    // State is empty before update().
    objectsInArrayInclude([], skinnyClient.getAllProposePriceEvents());
    await skinnyClient.update();
    objectsInArrayInclude(skinnyClient.getAllProposePriceEvents(), [
      {
        transactionHash: skinnyProposalTxn1.transactionHash,
        blockNumber: skinnyProposalTxn1.blockNumber,
        logIndex: skinnyProposalLogIndex1,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        request: proposeEvents[0].returnValues.request,
      },
      {
        transactionHash: skinnyProposalTxn2.transactionHash,
        blockNumber: skinnyProposalTxn2.blockNumber,
        logIndex: skinnyProposalLogIndex2,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        request: proposeEvents[1].returnValues.request,
      },
    ]);

    // Correctly adds only new events after last query
    await skinnyOptimisticOracle.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0, finalFee, 0)
      .send({ from: skinnyRequester });
    const newRequestEvent = (await skinnyOptimisticOracle.getPastEvents("RequestPrice", { fromBlock: 0 })).slice(-1)[0];
    const newTxn = await skinnyOptimisticOracle.methods
      .proposePrice(
        skinnyRequester,
        identifier,
        requestTime,
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        collateral.options.address.toLowerCase(),
        newRequestEvent.returnValues.request,
        correctPrice
      )
      .send({ from: proposer });
    const newLogIndex = getLogIndex(newTxn, "ProposePrice", SkinnyOptimisticOracle.abi);
    await skinnyClient.clearState();
    await skinnyClient.update();
    const newProposeEvent = (await skinnyOptimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 })).slice(-1)[0];
    objectsInArrayInclude(skinnyClient.getAllProposePriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        request: newProposeEvent.returnValues.request,
      },
    ]);
  });
  it("Return DisputePrice events", async function () {
    await client.clearState();
    // State is empty before update().
    objectsInArrayInclude([], client.getAllDisputePriceEvents());
    await client.update();
    objectsInArrayInclude(client.getAllDisputePriceEvents(), [
      {
        transactionHash: disputeTxn1.transactionHash,
        blockNumber: disputeTxn1.blockNumber,
        logIndex: disputeLogIndex1,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        proposedPrice: correctPrice,
        currency: collateral.options.address,
      },
      {
        transactionHash: disputeTxn2.transactionHash,
        blockNumber: disputeTxn2.blockNumber,
        logIndex: disputeLogIndex2,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        proposedPrice: correctPrice,
        currency: collateral.options.address,
      },
    ]);

    // Correctly adds only new events after last query
    await optimisticOracle.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0)
      .send({ from: requester });
    await optimisticOracle.methods
      .proposePrice(requester, identifier, requestTime, collateral.options.address.toLowerCase(), correctPrice)
      .send({ from: proposer });
    const newTxn = await optimisticOracle.methods
      .disputePrice(requester, identifier, requestTime, collateral.options.address.toLowerCase())
      .send({ from: disputer });
    const newLogIndex = getLogIndex(newTxn, "DisputePrice", OptimisticOracle.abi);
    await client.clearState();
    await client.update();
    objectsInArrayInclude(client.getAllDisputePriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        proposedPrice: correctPrice,
        currency: collateral.options.address,
      },
    ]);
  });
  it("Return OptimisticOracleV2 DisputePrice events", async function () {
    await clientV2.clearState();
    // State is empty before update().
    objectsInArrayInclude([], clientV2.getAllDisputePriceEvents());
    await clientV2.update();
    objectsInArrayInclude(clientV2.getAllDisputePriceEvents(), [
      {
        transactionHash: disputeV2Txn1.transactionHash,
        blockNumber: disputeV2Txn1.blockNumber,
        logIndex: disputeV2LogIndex1,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 2).toString(),
        proposedPrice: correctPrice,
        currency: collateral.options.address,
      },
      {
        transactionHash: disputeV2Txn2.transactionHash,
        blockNumber: disputeV2Txn2.blockNumber,
        logIndex: disputeV2LogIndex2,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 3).toString(),
        proposedPrice: correctPrice,
        currency: collateral.options.address,
      },
    ]);

    // Correctly adds only new events after last query
    await optimisticOracleV2.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0)
      .send({ from: requester });
    await optimisticOracleV2.methods
      .proposePrice(requester, identifier, requestTime, collateral.options.address.toLowerCase(), correctPrice)
      .send({ from: proposer });
    const newTxn = await optimisticOracleV2.methods
      .disputePrice(requester, identifier, requestTime, collateral.options.address.toLowerCase())
      .send({ from: disputer });
    const newLogIndex = getLogIndex(newTxn, "DisputePrice", OptimisticOracleV2.abi);
    await clientV2.clearState();
    await clientV2.update();
    objectsInArrayInclude(clientV2.getAllDisputePriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        proposedPrice: correctPrice,
        currency: collateral.options.address,
      },
    ]);
  });
  it("Return Skinny DisputePrice events", async function () {
    await skinnyClient.clearState();
    // State is empty before update().
    objectsInArrayInclude([], skinnyClient.getAllDisputePriceEvents());
    await skinnyClient.update();
    objectsInArrayInclude(skinnyClient.getAllDisputePriceEvents(), [
      {
        transactionHash: skinnyDisputeTxn1.transactionHash,
        blockNumber: skinnyDisputeTxn1.blockNumber,
        logIndex: skinnyDisputeLogIndex1,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        request: disputeEvents[0].returnValues.request,
      },
      {
        transactionHash: skinnyDisputeTxn2.transactionHash,
        blockNumber: skinnyDisputeTxn2.blockNumber,
        logIndex: skinnyDisputeLogIndex2,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        request: disputeEvents[1].returnValues.request,
      },
    ]);

    // Correctly adds only new events after last query
    await skinnyOptimisticOracle.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0, finalFee, 0)
      .send({ from: skinnyRequester });
    const newRequestEvent = (await skinnyOptimisticOracle.getPastEvents("RequestPrice", { fromBlock: 0 })).slice(-1)[0];
    await skinnyOptimisticOracle.methods
      .proposePrice(
        skinnyRequester,
        identifier,
        requestTime,
        collateral.options.address.toLowerCase(),
        newRequestEvent.returnValues.request,
        correctPrice
      )
      .send({ from: proposer });
    const newProposeEvent = (await skinnyOptimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 })).slice(-1)[0];
    const newTxn = await skinnyOptimisticOracle.methods
      .disputePrice(
        skinnyRequester,
        identifier,
        requestTime,
        collateral.options.address.toLowerCase(),
        newProposeEvent.returnValues.request
      )
      .send({ from: disputer });
    const newLogIndex = getLogIndex(newTxn, "DisputePrice", SkinnyOptimisticOracle.abi);
    await skinnyClient.clearState();
    await skinnyClient.update();
    const newDisputeEvent = (await skinnyOptimisticOracle.getPastEvents("DisputePrice", { fromBlock: 0 })).slice(-1)[0];
    objectsInArrayInclude(skinnyClient.getAllDisputePriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        request: newDisputeEvent.returnValues.request,
      },
    ]);
  });
  it("Return Settlement events", async function () {
    await client.clearState();
    // State is empty before update().
    objectsInArrayInclude([], client.getAllSettlementEvents());
    await client.update();
    objectsInArrayInclude(client.getAllSettlementEvents(), [
      {
        transactionHash: settlementTxn1.transactionHash,
        blockNumber: settlementTxn1.blockNumber,
        logIndex: settlementLogIndex1,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        price: correctPrice,
        payout: disputePayout,
        currency: collateral.options.address,
      },
      {
        transactionHash: settlementTxn2.transactionHash,
        blockNumber: settlementTxn2.blockNumber,
        logIndex: settlementLogIndex2,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        price: correctPrice,
        payout: disputePayout,
        currency: collateral.options.address,
      },
    ]);

    // Correctly adds only new events after last query
    await optimisticOracle.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0)
      .send({ from: requester });
    const newProposalTime = await optimisticOracle.methods.getCurrentTime().call();
    await optimisticOracle.methods
      .proposePrice(requester, identifier, requestTime, collateral.options.address.toLowerCase(), correctPrice)
      .send({ from: proposer });
    await optimisticOracle.methods
      .setCurrentTime((Number(newProposalTime) + liveness).toString())
      .send({ from: accounts[0] });
    const newTxn = await optimisticOracle.methods
      .settle(requester, identifier, requestTime, collateral.options.address.toLowerCase())
      .send({ from: accounts[0] });
    const newLogIndex = getLogIndex(newTxn, "Settle", OptimisticOracle.abi);
    await client.clearState();
    await client.update();
    objectsInArrayInclude(client.getAllSettlementEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: requester,
        proposer,
        disputer: ZERO_ADDRESS,
        identifier: hexToUtf8(identifier),
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        price: correctPrice,
        payout: totalDefaultBond,
        currency: collateral.options.address,
      },
    ]);
  });
  it("Return OptimisticOracleV2 Settlement events", async function () {
    await clientV2.clearState();
    // State is empty before update().
    objectsInArrayInclude([], clientV2.getAllSettlementEvents());
    await clientV2.update();
    objectsInArrayInclude(clientV2.getAllSettlementEvents(), [
      {
        transactionHash: settlementV2Txn1.transactionHash,
        blockNumber: settlementV2Txn1.blockNumber,
        logIndex: settlementV2LogIndex1,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 2).toString(),
        price: correctPrice,
        payout: disputePayout,
        currency: collateral.options.address,
      },
      {
        transactionHash: settlementV2Txn2.transactionHash,
        blockNumber: settlementV2Txn2.blockNumber,
        logIndex: settlementV2LogIndex2,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 3).toString(),
        price: correctPrice,
        payout: disputePayout,
        currency: collateral.options.address,
      },
    ]);

    // Correctly adds only new events after last query
    await optimisticOracleV2.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0)
      .send({ from: requester });
    const newProposalTime = await optimisticOracleV2.methods.getCurrentTime().call();
    await optimisticOracleV2.methods
      .proposePrice(requester, identifier, requestTime, collateral.options.address.toLowerCase(), correctPrice)
      .send({ from: proposer });
    await optimisticOracleV2.methods
      .setCurrentTime((Number(newProposalTime) + liveness).toString())
      .send({ from: accounts[0] });
    const newTxn = await optimisticOracleV2.methods
      .settle(requester, identifier, requestTime, collateral.options.address.toLowerCase())
      .send({ from: accounts[0] });
    const newLogIndex = getLogIndex(newTxn, "Settle", OptimisticOracleV2.abi);
    await clientV2.clearState();
    await clientV2.update();
    objectsInArrayInclude(clientV2.getAllSettlementEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: requester,
        proposer,
        disputer: ZERO_ADDRESS,
        identifier: hexToUtf8(identifier),
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        price: correctPrice,
        payout: totalDefaultBond,
        currency: collateral.options.address,
      },
    ]);
  });
  it("Return Skinny Settlement events", async function () {
    await skinnyClient.clearState();
    // State is empty before update().
    objectsInArrayInclude([], skinnyClient.getAllSettlementEvents());
    await skinnyClient.update();
    objectsInArrayInclude(skinnyClient.getAllSettlementEvents(), [
      {
        transactionHash: skinnySettlementTxn1.transactionHash,
        blockNumber: skinnySettlementTxn1.blockNumber,
        logIndex: skinnySettlementLogIndex1,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        request: settleEvents[0].returnValues.request,
      },
      {
        transactionHash: skinnySettlementTxn2.transactionHash,
        blockNumber: skinnySettlementTxn2.blockNumber,
        logIndex: skinnySettlementLogIndex2,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        request: settleEvents[1].returnValues.request,
      },
    ]);

    // Correctly adds only new events after last query
    await skinnyOptimisticOracle.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0, finalFee, 0)
      .send({ from: skinnyRequester });
    const newRequestEvent = (await skinnyOptimisticOracle.getPastEvents("RequestPrice", { fromBlock: 0 })).slice(-1)[0];
    const newProposalTime = await skinnyOptimisticOracle.methods.getCurrentTime().call();
    await skinnyOptimisticOracle.methods
      .proposePrice(
        skinnyRequester,
        identifier,
        requestTime,
        collateral.options.address.toLowerCase(),
        newRequestEvent.returnValues.request,
        correctPrice
      )
      .send({ from: proposer });
    await skinnyOptimisticOracle.methods
      .setCurrentTime((Number(newProposalTime) + liveness).toString())
      .send({ from: accounts[0] });
    const newProposeEvent = (await skinnyOptimisticOracle.getPastEvents("ProposePrice", { fromBlock: 0 })).slice(-1)[0];
    const newTxn = await skinnyOptimisticOracle.methods
      .settle(
        skinnyRequester,
        identifier,
        requestTime,
        collateral.options.address.toLowerCase(),
        newProposeEvent.returnValues.request
      )
      .send({ from: accounts[0] });
    const newLogIndex = getLogIndex(newTxn, "Settle", SkinnyOptimisticOracle.abi);
    await skinnyClient.clearState();
    await skinnyClient.update();
    const newSettleEvent = (await skinnyOptimisticOracle.getPastEvents("Settle", { fromBlock: 0 })).slice(-1)[0];
    objectsInArrayInclude(skinnyClient.getAllSettlementEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        logIndex: newLogIndex,
        requester: skinnyRequester,
        identifier: hexToUtf8(identifier),
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        ancillaryData: collateral.options.address.toLowerCase(),
        timestamp: requestTime.toString(),
        request: newSettleEvent.returnValues.request,
      },
    ]);
  });
  it("Starting client at an offset block number", async function () {
    // Init the event client with an offset block number. If the current block number is used then all log events
    // generated before the creation of the client should not be included. Rather, only subsequent logs should be reported.

    const currentBlockNumber = await web3.eth.getBlockNumber();
    const offSetClient = new OptimisticOracleEventClient(
      dummyLogger,
      OptimisticOracle.abi,
      web3,
      optimisticOracle.options.address,
      OptimisticOracleType.OptimisticOracle,
      currentBlockNumber + 1, // Start the bot one block after the latest event
      null // ending block number
    );
    const currentTimestamp = (await web3.eth.getBlock("latest")).timestamp;
    await advanceBlockAndSetTime(web3, currentTimestamp + 1);
    await advanceBlockAndSetTime(web3, currentTimestamp + 2);
    await advanceBlockAndSetTime(web3, currentTimestamp + 3);

    await offSetClient.update();

    objectsInArrayInclude([], offSetClient.getAllRequestPriceEvents());
    objectsInArrayInclude([], offSetClient.getAllProposePriceEvents());
    objectsInArrayInclude([], offSetClient.getAllDisputePriceEvents());
    objectsInArrayInclude([], offSetClient.getAllSettlementEvents());
  });
  it("Update with no max blocks per search set", async function () {
    await client.clearState();
    await client.update();

    // There should have been exactly 1 search each for the 4 events, so 4 web3 requests total.
    const blockSearchConfigLogs = spy
      .getCalls()
      .filter((log) => log.lastArg.message.includes("Queried past event requests"));
    assert.equal(blockSearchConfigLogs[0].lastArg.eventRequestCount, 4);
  });
  it("If max blocks per search is set, makes multiple web3 requests to fetch all events", async function () {
    const chunkedClient = new OptimisticOracleEventClient(
      winston.createLogger({ level: "debug", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
      OptimisticOracle.abi,
      web3,
      optimisticOracle.options.address,
      OptimisticOracleType.OptimisticOracle,
      0, // startingBlockNumber
      null, // endingBlockNumber
      10 // Search 2 blocks at a time
    );

    await chunkedClient.clearState();
    await chunkedClient.update();

    // There should have been > 1 search each for the 4 events, so > 4 web3 requests total.
    const blockSearchConfigLogs = spy
      .getCalls()
      .filter((log) => log.lastArg.message.includes("Queried past event requests"));
    assert.isTrue(blockSearchConfigLogs[0].lastArg.eventRequestCount > 4);

    // Now check that the events are stored correctly and exactly the same as in previous tests.
    objectsInArrayInclude(chunkedClient.getAllRequestPriceEvents(), [
      {
        transactionHash: requestTxn1.transactionHash,
        blockNumber: requestTxn1.blockNumber,
        logIndex: requestLogIndex1,
        requester: requester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        currency: collateral.options.address,
        reward: "0",
        finalFee,
      },
      {
        transactionHash: requestTxn2.transactionHash,
        blockNumber: requestTxn2.blockNumber,
        logIndex: requestLogIndex2,
        requester: requester,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        currency: collateral.options.address,
        reward: "0",
        finalFee,
      },
    ]);
    objectsInArrayInclude(chunkedClient.getAllProposePriceEvents(), [
      {
        transactionHash: proposalTxn1.transactionHash,
        blockNumber: proposalTxn1.blockNumber,
        logIndex: proposalLogIndex1,
        requester: requester,
        proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        currency: collateral.options.address,
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(proposalTime) + liveness).toString(),
      },
      {
        transactionHash: proposalTxn2.transactionHash,
        blockNumber: proposalTxn2.blockNumber,
        logIndex: proposalLogIndex2,
        requester: requester,
        proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        currency: collateral.options.address,
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(proposalTime) + liveness).toString(),
      },
    ]);
    objectsInArrayInclude(chunkedClient.getAllDisputePriceEvents(), [
      {
        transactionHash: disputeTxn1.transactionHash,
        blockNumber: disputeTxn1.blockNumber,
        logIndex: disputeLogIndex1,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        proposedPrice: correctPrice,
        currency: collateral.options.address,
      },
      {
        transactionHash: disputeTxn2.transactionHash,
        blockNumber: disputeTxn2.blockNumber,
        logIndex: disputeLogIndex2,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        proposedPrice: correctPrice,
        currency: collateral.options.address,
      },
    ]);
    objectsInArrayInclude(chunkedClient.getAllSettlementEvents(), [
      {
        transactionHash: settlementTxn1.transactionHash,
        blockNumber: settlementTxn1.blockNumber,
        logIndex: settlementLogIndex1,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: requestTime.toString(),
        price: correctPrice,
        payout: disputePayout,
        currency: collateral.options.address,
      },
      {
        transactionHash: settlementTxn2.transactionHash,
        blockNumber: settlementTxn2.blockNumber,
        logIndex: settlementLogIndex2,
        requester: requester,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        price: correctPrice,
        payout: disputePayout,
        currency: collateral.options.address,
      },
    ]);
  });
});
