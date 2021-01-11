const winston = require("winston");

const { toWei, hexToUtf8, utf8ToHex } = web3.utils;

const { OptimisticOracleClient } = require("../../src/clients/OptimisticOracleClient");
const { interfaceName, advanceBlockAndSetTime } = require("@uma/common");
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

contract("OptimisticOracleClient.js", function(accounts) {
  const owner = accounts[0];
  const requester = accounts[1];
  const proposer = accounts[2];
  const rando = accounts[3];

  let optimisticRequester;
  let optimisticOracle;
  let client;
  let dummyLogger;

  let finder;
  let timer;
  let identifierWhitelist;
  let collateralWhitelist;
  let store;
  let collateral;

  // Timestamps that we'll use throughout the test.
  let requestTime;
  let startTime;

  // Default testing values.
  const liveness = 7200; // 2 hours
  const initialUserBalance = toWei("100");
  const finalFee = toWei("1");
  const totalDefaultBond = toWei("2"); // 2x final fee
  const correctPrice = toWei("-17");
  const identifier = web3.utils.utf8ToHex("Test Identifier");

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
  });

  beforeEach(async function() {
    // Deploy and whitelist a new collateral currency that we will use to pay oracle fees.
    collateral = await Token.new("Wrapped Ether", "WETH", 18);
    await collateral.addMember(1, owner);
    await collateral.mint(owner, initialUserBalance);
    await collateral.mint(proposer, initialUserBalance);
    await collateral.mint(requester, initialUserBalance);
    await collateral.mint(rando, initialUserBalance);
    await collateralWhitelist.addToWhitelist(collateral.address);

    // Set a non-0 final fee for the collateral currency.
    await store.setFinalFee(collateral.address, { rawValue: finalFee });

    optimisticOracle = await OptimisticOracle.new(liveness, finder.address, timer.address);

    // Contract used to make price requests
    optimisticRequester = await OptimisticRequesterTest.new(optimisticOracle.address);

    startTime = (await optimisticOracle.getCurrentTime()).toNumber();
    requestTime = startTime - 10;

    // The ExpiringMultiPartyClient does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });

    client = new OptimisticOracleClient(dummyLogger, OptimisticOracle.abi, web3, optimisticOracle.address);
  });

  it("Can detect unproposed price requests", async function() {
    // Initial update.
    await client.update();

    // Initially, no price requests.
    let result = client.getUnproposedPriceRequests();
    assert.deepStrictEqual(result, []);

    // Request and update again.
    await optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, 0);
    await client.update();

    // Should have one price request.
    result = client.getUnproposedPriceRequests();
    assert.deepStrictEqual(result, [
      {
        requester: optimisticRequester.address,
        identifier: hexToUtf8(identifier),
        timestamp: requestTime.toString(),
        currency: collateral.address,
        reward: "0",
        finalFee
      }
    ]);
  });

  it("Can detect proposed price requests", async function() {
    // Initial update.
    await client.update();

    // Initially, no proposals.
    let result = client.getUndisputedProposals();
    assert.deepStrictEqual(result, []);

    // Request and update again, should still show no proposals.
    await optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, 0);
    await client.update();
    result = client.getUndisputedProposals();
    assert.deepStrictEqual(result, []);

    // Make a proposal and update, should now show one proposal, 0 unproposed requests, and 0 expired proposals:
    await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
    const currentContractTime = await optimisticOracle.getCurrentTime();
    await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
      from: proposer
    });

    await client.update();
    result = client.getUndisputedProposals();
    assert.deepStrictEqual(result, [
      {
        requester: optimisticRequester.address,
        proposer: proposer,
        identifier: hexToUtf8(identifier),
        timestamp: requestTime.toString(),
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(currentContractTime) + liveness).toString()
      }
    ]);
    result = client.getUnproposedPriceRequests();
    assert.deepStrictEqual(result, []);
    result = client.getExpiredProposals();
    assert.deepStrictEqual(result, []);

    // Now, advance time so that the proposal expires and check that the client detects the new state:
    await optimisticOracle.setCurrentTime((Number(currentContractTime) + liveness).toString());
    await client.update();
    result = client.getUndisputedProposals();
    assert.deepStrictEqual(result, []);
    result = client.getUnproposedPriceRequests();
    assert.deepStrictEqual(result, []);
    result = client.getExpiredProposals();
    assert.deepStrictEqual(result, [
      {
        requester: optimisticRequester.address,
        proposer: proposer,
        identifier: hexToUtf8(identifier),
        timestamp: requestTime.toString(),
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(currentContractTime) + liveness).toString()
      }
    ]);
  });

  it("Lookback window enforced", async function() {
    // Create a new client with a shorter lookback equal to approximately
    // the amount of seconds that it takes 1 block to get mined
    let clientShortLookback = new OptimisticOracleClient(
      dummyLogger,
      OptimisticOracle.abi,
      web3,
      optimisticOracle.address,
      13
    );

    // Request a price and check that the longer lookback client currently sees it
    await optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, 0);
    await client.update();
    let result = client.getUnproposedPriceRequests();
    assert.deepStrictEqual(result, [
      {
        requester: optimisticRequester.address,
        identifier: hexToUtf8(identifier),
        timestamp: requestTime.toString(),
        currency: collateral.address,
        reward: "0",
        finalFee
      }
    ]);

    // Mine two blocks to move past the lookback window, and make sure the shorter lookback client
    // ignores the price request.
    await advanceBlockAndSetTime(web3, new Date().getTime());
    await advanceBlockAndSetTime(web3, new Date().getTime());

    await clientShortLookback.update();
    result = clientShortLookback.getUnproposedPriceRequests();
    assert.deepStrictEqual(result, []);
  });
});
