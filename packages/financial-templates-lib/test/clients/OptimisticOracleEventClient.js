const { web3, getContract } = require("hardhat");
const { assert } = require("chai");

const winston = require("winston");

const { toWei, hexToUtf8, utf8ToHex, toBN } = web3.utils;

const { OptimisticOracleEventClient } = require("../../dist/clients/OptimisticOracleEventClient");
const { interfaceName, advanceBlockAndSetTime, MAX_UINT_VAL, ZERO_ADDRESS } = require("@uma/common");

const OptimisticOracle = getContract("OptimisticOracle");
const OptimisticRequesterTest = getContract("OptimisticRequesterTest");
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
  let owner, requester, proposer, disputer, accounts;

  // Contracts
  let optimisticRequester;
  let optimisticOracle;
  let mockOracle;
  let finder;
  let timer;
  let identifierWhitelist;
  let collateralWhitelist;
  let store;
  let collateral;

  // Bot helper modules
  let client;
  let dummyLogger;

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

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, requester, proposer, disputer] = accounts;

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

    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: accounts[0] });
  });

  let requestTxn1, requestTxn2, proposalTxn1, proposalTxn2, disputeTxn1, disputeTxn2, settlementTxn1, settlementTxn2;
  beforeEach(async function () {
    // Deploy and whitelist a new collateral currency that we will use to pay oracle fees.
    collateral = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] });
    await collateral.methods.addMember(1, owner).send({ from: accounts[0] });
    await collateral.methods.mint(owner, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(proposer, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(requester, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(disputer, initialUserBalance).send({ from: accounts[0] });
    await collateralWhitelist.methods.addToWhitelist(collateral.options.address).send({ from: accounts[0] });

    // Set a non-0 final fee for the collateral currency.
    await store.methods.setFinalFee(collateral.options.address, { rawValue: finalFee }).send({ from: accounts[0] });

    optimisticOracle = await OptimisticOracle.new(liveness, finder.options.address, timer.options.address).send({
      from: accounts[0],
    });

    // Contract used to make price requests
    optimisticRequester = await OptimisticRequesterTest.new(optimisticOracle.options.address).send({
      from: accounts[0],
    });

    startTime = parseInt(await optimisticOracle.methods.getCurrentTime().call());
    requestTime = startTime - 10;

    // The Event client does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    client = new OptimisticOracleEventClient(
      dummyLogger,
      OptimisticOracle.abi,
      web3,
      optimisticOracle.options.address,
      0, // startingBlockNumber
      null // endingBlockNumber
    );

    // Make price requests
    requestTxn1 = await optimisticRequester.methods
      .requestPrice(identifier, requestTime, defaultAncillaryData, collateral.options.address, 0)
      .send({ from: accounts[0] });
    requestTxn2 = await optimisticRequester.methods
      .requestPrice(identifier, requestTime + 1, defaultAncillaryData, collateral.options.address, 0)
      .send({ from: accounts[0] });

    // Make proposals
    await collateral.methods.approve(optimisticOracle.options.address, MAX_UINT_VAL).send({ from: proposer });
    proposalTime = await optimisticOracle.methods.getCurrentTime().call();
    proposalTxn1 = await optimisticOracle.methods
      .proposePrice(optimisticRequester.options.address, identifier, requestTime, defaultAncillaryData, correctPrice)
      .send({ from: proposer });
    proposalTxn2 = await optimisticOracle.methods
      .proposePrice(
        optimisticRequester.options.address,
        identifier,
        requestTime + 1,
        defaultAncillaryData,
        correctPrice
      )
      .send({ from: proposer });

    // Make disputes and resolve them
    await collateral.methods.approve(optimisticOracle.options.address, MAX_UINT_VAL).send({ from: disputer });
    disputeTxn1 = await optimisticOracle.methods
      .disputePrice(optimisticRequester.options.address, identifier, requestTime, defaultAncillaryData)
      .send({ from: disputer });
    await pushPrice(correctPrice);
    disputeTxn2 = await optimisticOracle.methods
      .disputePrice(optimisticRequester.options.address, identifier, requestTime + 1, defaultAncillaryData)
      .send({ from: disputer });
    await pushPrice(correctPrice);

    // Settle expired proposals and resolved disputes
    settlementTxn1 = await optimisticOracle.methods
      .settle(optimisticRequester.options.address, identifier, requestTime, defaultAncillaryData)
      .send({ from: accounts[0] });
    settlementTxn2 = await optimisticOracle.methods
      .settle(optimisticRequester.options.address, identifier, requestTime + 1, defaultAncillaryData)
      .send({ from: accounts[0] });
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
        requester: optimisticRequester.options.address,
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
        requester: optimisticRequester.options.address,
        identifier: hexToUtf8(identifier),
        ancillaryData: defaultAncillaryData,
        timestamp: (requestTime + 1).toString(),
        currency: collateral.options.address,
        reward: "0",
        finalFee,
      },
    ]);

    // Correctly adds only new events after last query
    const newTxn = await optimisticRequester.methods
      .requestPrice(
        identifier,
        requestTime,
        // Note: we're using collateral address as ancillary data here to test with more entropy.
        collateral.options.address,
        collateral.options.address,
        0
      )
      .send({ from: accounts[0] });
    await client.clearState();
    await client.update();
    objectsInArrayInclude(client.getAllRequestPriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        requester: optimisticRequester.options.address,
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
  it("Return ProposePrice events", async function () {
    await client.clearState();
    // State is empty before update().
    objectsInArrayInclude([], client.getAllProposePriceEvents());
    await client.update();
    objectsInArrayInclude(client.getAllProposePriceEvents(), [
      {
        transactionHash: proposalTxn1.transactionHash,
        blockNumber: proposalTxn1.blockNumber,
        requester: optimisticRequester.options.address,
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
        requester: optimisticRequester.options.address,
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
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0)
      .send({ from: accounts[0] });
    const newProposalTime = await optimisticOracle.methods.getCurrentTime().call();
    const newTxn = await optimisticOracle.methods
      .proposePrice(
        optimisticRequester.options.address,
        identifier,
        requestTime,
        // Note: Convert contract address to lowercase to adjust for how Solidity casts addresses to bytes.
        // This is important because `requestPrice` expects `ancillaryData` to be of type bytes,
        collateral.options.address.toLowerCase(),
        correctPrice
      )
      .send({ from: proposer });
    await client.clearState();
    await client.update();
    objectsInArrayInclude(client.getAllProposePriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        requester: optimisticRequester.options.address,
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
  it("Return DisputePrice events", async function () {
    await client.clearState();
    // State is empty before update().
    objectsInArrayInclude([], client.getAllDisputePriceEvents());
    await client.update();
    objectsInArrayInclude(client.getAllDisputePriceEvents(), [
      {
        transactionHash: disputeTxn1.transactionHash,
        blockNumber: disputeTxn1.blockNumber,
        requester: optimisticRequester.options.address,
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
        requester: optimisticRequester.options.address,
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
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0)
      .send({ from: accounts[0] });
    await optimisticOracle.methods
      .proposePrice(
        optimisticRequester.options.address,
        identifier,
        requestTime,
        collateral.options.address.toLowerCase(),
        correctPrice
      )
      .send({ from: proposer });
    const newTxn = await optimisticOracle.methods
      .disputePrice(
        optimisticRequester.options.address,
        identifier,
        requestTime,
        collateral.options.address.toLowerCase()
      )
      .send({ from: disputer });
    await client.clearState();
    await client.update();
    objectsInArrayInclude(client.getAllDisputePriceEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        requester: optimisticRequester.options.address,
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
  it("Return Settlement events", async function () {
    await client.clearState();
    // State is empty before update().
    objectsInArrayInclude([], client.getAllSettlementEvents());
    await client.update();
    objectsInArrayInclude(client.getAllSettlementEvents(), [
      {
        transactionHash: settlementTxn1.transactionHash,
        blockNumber: settlementTxn1.blockNumber,
        requester: optimisticRequester.options.address,
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
        requester: optimisticRequester.options.address,
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
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, collateral.options.address, collateral.options.address, 0)
      .send({ from: accounts[0] });
    const newProposalTime = await optimisticOracle.methods.getCurrentTime().call();
    await optimisticOracle.methods
      .proposePrice(
        optimisticRequester.options.address,
        identifier,
        requestTime,
        collateral.options.address.toLowerCase(),
        correctPrice
      )
      .send({ from: proposer });
    await optimisticOracle.methods
      .setCurrentTime((Number(newProposalTime) + liveness).toString())
      .send({ from: accounts[0] });
    const newTxn = await optimisticOracle.methods
      .settle(optimisticRequester.options.address, identifier, requestTime, collateral.options.address.toLowerCase())
      .send({ from: accounts[0] });
    await client.clearState();
    await client.update();
    objectsInArrayInclude(client.getAllSettlementEvents(), [
      {
        transactionHash: newTxn.transactionHash,
        blockNumber: newTxn.blockNumber,
        requester: optimisticRequester.options.address,
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
  it("Starting client at an offset block number", async function () {
    // Init the event client with an offset block number. If the current block number is used then all log events
    // generated before the creation of the client should not be included. Rather, only subsequent logs should be reported.

    const currentBlockNumber = await web3.eth.getBlockNumber();
    const offSetClient = new OptimisticOracleEventClient(
      dummyLogger,
      OptimisticOracle.abi,
      web3,
      optimisticOracle.options.address,
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
});
