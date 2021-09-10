const { web3, getContract } = require("hardhat");
const { assert } = require("chai");

const winston = require("winston");

const { toWei, hexToUtf8, utf8ToHex } = web3.utils;

const { OptimisticOracleClient } = require("../../dist/clients/OptimisticOracleClient");
const { interfaceName, advanceBlockAndSetTime } = require("@uma/common");

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

describe("OptimisticOracleClient.js", function () {
  let owner, requester, proposer, disputer, rando, accounts;

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

  // Default testing values.
  const liveness = 7200; // 2 hours
  const initialUserBalance = toWei("100");
  const finalFee = toWei("1");
  const totalDefaultBond = toWei("2"); // 2x final fee
  const correctPrice = toWei("-17");
  const identifier = web3.utils.utf8ToHex("Test Identifier");

  const pushPrice = async (price) => {
    const [lastQuery] = (await mockOracle.methods.getPendingQueries().call()).slice(-1);
    await mockOracle.methods
      .pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price)
      .send({ from: accounts[0] });
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, requester, proposer, disputer, rando] = accounts;
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

    // The OptimisticOracleClient does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    client = new OptimisticOracleClient(
      dummyLogger,
      OptimisticOracle.abi,
      MockOracle.abi,
      web3,
      optimisticOracle.options.address,
      mockOracle.options.address
    );
  });

  it("Basic proposal lifecycle: request, propose, expire without dispute", async function () {
    // Initial update.
    await client.update();

    // Initially, no proposals and no price requests.
    let result = client.getUndisputedProposals();
    objectsInArrayInclude(result, []);
    result = client.getUnproposedPriceRequests();
    objectsInArrayInclude(result, []);
    result = client.getSettleableProposals(proposer);
    objectsInArrayInclude(result, []);

    // Request and update again, should show no proposals.
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, "0x", collateral.options.address, 0)
      .send({ from: accounts[0] });
    await client.update();
    result = client.getUndisputedProposals();
    objectsInArrayInclude(result, []);
    result = client.getSettleableProposals(proposer);
    objectsInArrayInclude(result, []);

    // Should have one price request.
    result = client.getUnproposedPriceRequests();
    objectsInArrayInclude(result, [
      {
        requester: optimisticRequester.options.address,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        timestamp: requestTime.toString(),
        currency: collateral.options.address,
        reward: "0",
        finalFee,
      },
    ]);

    // Make a proposal and update, should now show one proposal, 0 unproposed requests, and 0 expired proposals:
    await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
    const currentContractTime = await optimisticOracle.methods.getCurrentTime().call();
    await optimisticOracle.methods
      .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
      .send({ from: proposer });

    await client.update();
    result = client.getUndisputedProposals();
    objectsInArrayInclude(result, [
      {
        requester: optimisticRequester.options.address,
        proposer: proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        currency: collateral.options.address,
        timestamp: requestTime.toString(),
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(currentContractTime) + liveness).toString(),
      },
    ]);
    result = client.getUnproposedPriceRequests();
    objectsInArrayInclude(result, []);
    result = client.getSettleableProposals(proposer);
    objectsInArrayInclude(result, []);

    // Now, advance time so that the proposal expires and check that the client detects the new state:
    await optimisticOracle.methods
      .setCurrentTime((Number(currentContractTime) + liveness).toString())
      .send({ from: accounts[0] });
    await client.update();
    result = client.getUndisputedProposals();
    objectsInArrayInclude(result, []);
    result = client.getUnproposedPriceRequests();
    objectsInArrayInclude(result, []);
    // Note: `getSettleableProposals` only returns proposals where the `proposer` is involved
    result = client.getSettleableProposals(rando);
    objectsInArrayInclude(result, []);
    result = client.getSettleableProposals(proposer);
    objectsInArrayInclude(result, [
      {
        requester: optimisticRequester.options.address,
        proposer: proposer,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        currency: collateral.options.address,
        timestamp: requestTime.toString(),
        proposedPrice: correctPrice,
        expirationTimestamp: (Number(currentContractTime) + liveness).toString(),
      },
    ]);

    // Once proposals are settled they no longer appear as settleable in the client.
    await optimisticOracle.methods
      .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
      .send({ from: accounts[0] });
    await client.update();
    result = client.getSettleableProposals(proposer);
    objectsInArrayInclude(result, []);
  });

  it("Basic dispute lifecycle: request, propose, dispute, resolve & settle", async function () {
    // Initial update.
    await client.update();

    // Initially, no settleable disputes:
    let result = client.getSettleableDisputes(disputer);
    objectsInArrayInclude(result, []);

    // Request a price:
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, "0x", collateral.options.address, 0)
      .send({ from: accounts[0] });
    await client.update();
    result = client.getSettleableDisputes(disputer);
    objectsInArrayInclude(result, []);

    // Make a proposal:
    await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
    await optimisticOracle.methods
      .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
      .send({ from: proposer });

    await client.update();
    result = client.getSettleableDisputes(disputer);
    objectsInArrayInclude(result, []);

    // Dispute the proposal:
    await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
    await optimisticOracle.methods
      .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
      .send({ from: disputer });
    result = client.getSettleableDisputes(disputer);
    objectsInArrayInclude(result, []);

    // Resolve the dispute and check that the client detects the new state:
    await pushPrice(correctPrice);
    await client.update();
    // Note: `getSettleableDisputes` only returns proposals where the `disputer` is involved
    result = client.getSettleableDisputes(rando);
    objectsInArrayInclude(result, []);
    result = client.getSettleableDisputes(disputer);
    objectsInArrayInclude(result, [
      {
        requester: optimisticRequester.options.address,
        proposer: proposer,
        disputer: disputer,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        timestamp: requestTime.toString(),
      },
    ]);

    // Settle the dispute and make sure that the client no longer sees it as settleable:
    await optimisticOracle.methods
      .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
      .send({ from: accounts[0] });
    await client.update();
    result = client.getSettleableDisputes(disputer);
    objectsInArrayInclude(result, []);
  });

  it("Lookback window enforced", async function () {
    // Create a new client with a shorter lookback equal to approximately
    // the amount of seconds that it takes 1 block to get mined
    let clientShortLookback = new OptimisticOracleClient(
      dummyLogger,
      OptimisticOracle.abi,
      MockOracle.abi,
      web3,
      optimisticOracle.options.address,
      mockOracle.options.address,
      13
    );

    // Request a price and check that the longer lookback client currently sees it
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, "0x", collateral.options.address, 0)
      .send({ from: accounts[0] });
    await client.update();
    let result = client.getUnproposedPriceRequests();
    objectsInArrayInclude(result, [
      {
        requester: optimisticRequester.options.address,
        identifier: hexToUtf8(identifier),
        ancillaryData: "0x",
        timestamp: requestTime.toString(),
        currency: collateral.options.address,
        reward: "0",
        finalFee,
      },
    ]);

    // Mine two blocks to move past the lookback window, and make sure the shorter lookback client
    // ignores the price request.
    const currentTime = Number((await web3.eth.getBlock("latest")).timestamp);
    await advanceBlockAndSetTime(web3, currentTime + 1);
    await advanceBlockAndSetTime(web3, currentTime + 2);

    await clientShortLookback.update();
    result = clientShortLookback.getUnproposedPriceRequests();
    objectsInArrayInclude(result, []);
  });
});
