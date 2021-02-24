const winston = require("winston");

const { toWei, hexToUtf8, utf8ToHex } = web3.utils;

const { OptimisticOracleEventClient } = require("../../src/clients/OptimisticOracleEventClient");
const { interfaceName, advanceBlockAndSetTime, MAX_UINT_VAL, ZERO_ADDRESS } = require("@uma/common");
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

contract("OptimisticOracleEventClient.js", function(accounts) {
  const owner = accounts[0];
  const requester = accounts[1];
  const proposer = accounts[2];
  const disputer = accounts[3];

  let optimisticRequester;
  let optimisticOracle;
  let client;
  let dummyLogger;
  let mockOracle;

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
  const totalDefaultBond = toWei("2"); // 2x final fee
  const disputePayout = toWei("2.5"); // dispute bond + 50% of loser's bond
  const correctPrice = toWei("-17");
  const identifier = web3.utils.utf8ToHex("Test Identifier");

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

  let requestTxn1, requestTxn2, proposalTxn1, proposalTxn2, disputeTxn1, disputeTxn2, settlementTxn1, settlementTxn2;
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

    // Contract used to make price requests
    optimisticRequester = await OptimisticRequesterTest.new(optimisticOracle.address);

    startTime = (await optimisticOracle.getCurrentTime()).toNumber();
    requestTime = startTime - 10;

    // The Event client does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });

    client = new OptimisticOracleEventClient(
      dummyLogger,
      OptimisticOracle.abi,
      web3,
      optimisticOracle.address,
      0, // startingBlockNumber
      null // endingBlockNumber
    );

    // Make price requests
    requestTxn1 = await optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, 0);
    requestTxn2 = await optimisticRequester.requestPrice(identifier, requestTime + 1, "0x", collateral.address, 0);

    // Make proposals
    await collateral.approve(optimisticOracle.address, MAX_UINT_VAL, { from: proposer });
    proposalTime = await optimisticOracle.getCurrentTime();
    proposalTxn1 = await optimisticOracle.proposePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      "0x",
      correctPrice,
      {
        from: proposer
      }
    );
    proposalTxn2 = await optimisticOracle.proposePrice(
      optimisticRequester.address,
      identifier,
      requestTime + 1,
      "0x",
      correctPrice,
      {
        from: proposer
      }
    );

    // Make dispute2 and resolve them
    await collateral.approve(optimisticOracle.address, MAX_UINT_VAL, { from: disputer });
    disputeTxn1 = await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime, "0x", {
      from: disputer
    });
    await pushPrice(correctPrice);
    disputeTxn2 = await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime + 1, "0x", {
      from: disputer
    });
    await pushPrice(correctPrice);

    // Settle expired proposals and resolved disputes
    settlementTxn1 = await optimisticOracle.settle(optimisticRequester.address, identifier, requestTime, "0x");
    settlementTxn2 = await optimisticOracle.settle(optimisticRequester.address, identifier, requestTime + 1, "0x");
  });

  it("Return RequestPrice events", async function() {
    await client.clearState();
    // State is empty before update().
    assert.deepStrictEqual([], client.getAllRequestPriceEvents());
    await client.update();
    assert.deepStrictEqual(client.getAllRequestPriceEvents(), [
      {
        transactionHash: requestTxn1.tx,
        blockNumber: requestTxn1.receipt.blockNumber,
        requester: optimisticRequester.address,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        timestamp: requestTime.toString(),
        currency: collateral.address,
        reward: "0",
        finalFee
      },
      {
        transactionHash: requestTxn2.tx,
        blockNumber: requestTxn2.receipt.blockNumber,
        requester: optimisticRequester.address,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        timestamp: (requestTime + 1).toString(),
        currency: collateral.address,
        reward: "0",
        finalFee
      }
    ]);

    // Correctly adds only new events after last query
    const newTxn = await optimisticRequester.requestPrice(
      identifier,
      requestTime,
      collateral.address,
      collateral.address,
      0
    );
    await client.clearState();
    await client.update();
    assert.deepStrictEqual(client.getAllRequestPriceEvents(), [
      {
        transactionHash: newTxn.tx,
        blockNumber: newTxn.receipt.blockNumber,
        requester: optimisticRequester.address,
        identifier: hexToUtf8(identifier),
        ancillaryData: collateral.address.toLowerCase(),
        timestamp: requestTime.toString(),
        currency: collateral.address,
        reward: "0",
        finalFee
      }
    ]);
  });
  it("Return ProposePrice events", async function() {
    await client.clearState();
    // State is empty before update().
    assert.deepStrictEqual([], client.getAllProposePriceEvents());
    await client.update();
    assert.deepStrictEqual(client.getAllProposePriceEvents(), [
      {
        transactionHash: proposalTxn1.tx,
        blockNumber: proposalTxn1.receipt.blockNumber,
        requester: optimisticRequester.address,
        proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        timestamp: requestTime.toString(),
        currency: collateral.address,
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(proposalTime) + liveness).toString()
      },
      {
        transactionHash: proposalTxn2.tx,
        blockNumber: proposalTxn2.receipt.blockNumber,
        requester: optimisticRequester.address,
        proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        timestamp: (requestTime + 1).toString(),
        currency: collateral.address,
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(proposalTime) + liveness).toString()
      }
    ]);

    // Correctly adds only new events after last query
    await optimisticRequester.requestPrice(identifier, requestTime, collateral.address, collateral.address, 0);
    const newProposalTime = await optimisticOracle.getCurrentTime();
    const newTxn = await optimisticOracle.proposePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      collateral.address.toLowerCase(),
      correctPrice,
      {
        from: proposer
      }
    );
    await client.clearState();
    await client.update();
    assert.deepStrictEqual(client.getAllProposePriceEvents(), [
      {
        transactionHash: newTxn.tx,
        blockNumber: newTxn.receipt.blockNumber,
        requester: optimisticRequester.address,
        proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: collateral.address.toLowerCase(),
        timestamp: requestTime.toString(),
        currency: collateral.address,
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(newProposalTime) + liveness).toString()
      }
    ]);
  });
  it("Return DisputePrice events", async function() {
    await client.clearState();
    // State is empty before update().
    assert.deepStrictEqual([], client.getAllDisputePriceEvents());
    await client.update();
    assert.deepStrictEqual(client.getAllDisputePriceEvents(), [
      {
        transactionHash: disputeTxn1.tx,
        blockNumber: disputeTxn1.receipt.blockNumber,
        requester: optimisticRequester.address,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        timestamp: requestTime.toString(),
        proposedPrice: correctPrice
      },
      {
        transactionHash: disputeTxn2.tx,
        blockNumber: disputeTxn2.receipt.blockNumber,
        requester: optimisticRequester.address,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        timestamp: (requestTime + 1).toString(),
        proposedPrice: correctPrice
      }
    ]);

    // Correctly adds only new events after last query
    await optimisticRequester.requestPrice(identifier, requestTime, collateral.address, collateral.address, 0);
    await optimisticOracle.proposePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      collateral.address.toLowerCase(),
      correctPrice,
      {
        from: proposer
      }
    );
    const newTxn = await optimisticOracle.disputePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      collateral.address.toLowerCase(),
      { from: disputer }
    );
    await client.clearState();
    await client.update();
    assert.deepStrictEqual(client.getAllDisputePriceEvents(), [
      {
        transactionHash: newTxn.tx,
        blockNumber: newTxn.receipt.blockNumber,
        requester: optimisticRequester.address,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: collateral.address.toLowerCase(),
        timestamp: requestTime.toString(),
        proposedPrice: correctPrice
      }
    ]);
  });
  it("Return Settlement events", async function() {
    await client.clearState();
    // State is empty before update().
    assert.deepStrictEqual([], client.getAllSettlementEvents());
    await client.update();
    assert.deepStrictEqual(client.getAllSettlementEvents(), [
      {
        transactionHash: settlementTxn1.tx,
        blockNumber: settlementTxn1.receipt.blockNumber,
        requester: optimisticRequester.address,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        timestamp: requestTime.toString(),
        price: correctPrice,
        payout: disputePayout
      },
      {
        transactionHash: settlementTxn2.tx,
        blockNumber: settlementTxn2.receipt.blockNumber,
        requester: optimisticRequester.address,
        proposer,
        disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        timestamp: (requestTime + 1).toString(),
        price: correctPrice,
        payout: disputePayout
      }
    ]);

    // Correctly adds only new events after last query
    await optimisticRequester.requestPrice(identifier, requestTime, collateral.address, collateral.address, 0);
    const newProposalTime = await optimisticOracle.getCurrentTime();
    await optimisticOracle.proposePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      collateral.address.toLowerCase(),
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
      collateral.address.toLowerCase()
    );
    await client.clearState();
    await client.update();
    assert.deepStrictEqual(client.getAllSettlementEvents(), [
      {
        transactionHash: newTxn.tx,
        blockNumber: newTxn.receipt.blockNumber,
        requester: optimisticRequester.address,
        proposer,
        disputer: ZERO_ADDRESS,
        identifier: hexToUtf8(identifier),
        ancillaryData: collateral.address.toLowerCase(),
        timestamp: requestTime.toString(),
        price: correctPrice,
        payout: totalDefaultBond
      }
    ]);
  });
  it("Starting client at an offset block number", async function() {
    // Init the event client with an offset block number. If the current block number is used then all log events
    // generated before the creation of the client should not be included. Rather, only subsequent logs should be reported.

    const currentBlockNumber = await web3.eth.getBlockNumber();
    const offSetClient = new OptimisticOracleEventClient(
      dummyLogger,
      optimisticOracle.abi,
      web3,
      optimisticOracle.address,
      currentBlockNumber + 1, // Start the bot one block after the latest event
      null // ending block number
    );
    const currentTimestamp = (await web3.eth.getBlock("latest")).timestamp;
    await advanceBlockAndSetTime(web3, currentTimestamp + 1);
    await advanceBlockAndSetTime(web3, currentTimestamp + 2);
    await advanceBlockAndSetTime(web3, currentTimestamp + 3);

    await offSetClient.update();

    assert.deepStrictEqual([], offSetClient.getAllRequestPriceEvents());
    assert.deepStrictEqual([], offSetClient.getAllProposePriceEvents());
    assert.deepStrictEqual([], offSetClient.getAllDisputePriceEvents());
    assert.deepStrictEqual([], offSetClient.getAllSettlementEvents());
  });
});
