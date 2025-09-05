import "@nomiclabs/hardhat-ethers";
import { addGlobalHardhatTestingAddress, ZERO_ADDRESS } from "@uma/common";
import {
  FinderEthers,
  IdentifierWhitelistEthers,
  OptimisticOracleEthers,
  OptimisticOracleV2Ethers,
  VotingTokenEthers,
} from "@uma/contracts-node";
import { createNewLogger, SpyTransport } from "@uma/financial-templates-lib";
import { createHttpClient } from "@uma/toolkit";
import { assert } from "chai";
import sinon from "sinon";
import * as commonModule from "../src/monitor-polymarket/common";
import {
  MarketOrderbook,
  MonitoringParams,
  OptimisticPriceRequest,
  PolymarketMarketGraphqlProcessed,
} from "../src/monitor-polymarket/common";
import { monitorTransactionsProposedOrderBook } from "../src/monitor-polymarket/MonitorProposalsOrderBook";
import { formatBytes32String, getContractFactory, hre, Provider, Signer, toUtf8Bytes } from "./utils";

const ethers = hre.ethers;

// Helper to normalize SpyTransport payload shape
const extractMsg = (arg: any) => (arg?.event ? arg : arg?.message ? arg.message : arg);

describe("Polymarket monitor: market check + first-ok", function () {
  let sandbox: sinon.SinonSandbox;
  let oov2: OptimisticOracleV2Ethers;
  let oo: OptimisticOracleEthers;
  let deployer: Signer;
  let votingToken: VotingTokenEthers;

  const identifier = formatBytes32String("TEST_IDENTIFIER");
  const ancillaryData = toUtf8Bytes(`q:"Is the sky blue?"`);
  const ONE = ethers.utils.parseEther("1");

  const marketInfo: PolymarketMarketGraphqlProcessed[] = [
    {
      clobTokenIds: ["0xT0", "0xT1"],
      volumeNum: 100_000,
      outcomes: ["Yes", "No"],
      outcomePrices: ["1", "0"],
      question: "Is the sky blue?",
      questionID: "0xMKT1",
    },
  ];

  const emptyBooks: Record<string, MarketOrderbook> = {
    [marketInfo[0].clobTokenIds[0]]: { bids: [], asks: [] },
    [marketInfo[0].clobTokenIds[1]]: { bids: [], asks: [] },
  };

  const createMonitoringParams = async (): Promise<MonitoringParams> => {
    const ctfAdapterAddress = await deployer.getAddress();
    return {
      binaryAdapterAddress: "0x1111",
      ctfAdapterAddress,
      ctfAdapterAddressV2: "0x2222",
      ctfExchangeAddress: "0x3333",
      ctfSportsOracleAddress: "0x4444",
      maxBlockLookBack: 3499,
      graphqlEndpoint: "endpoint",
      polymarketApiKey: "key",
      apiEndpoint: "endpoint",
      provider: ethers.provider as Provider,
      chainId: (await ethers.provider.getNetwork()).chainId,
      pollingDelay: 0,
      unknownProposalNotificationInterval: 300,
      retryAttempts: 1,
      retryDelayMs: 0,
      checkBeforeExpirationSeconds: 1800,
      fillEventsLookbackSeconds: 0,
      httpClient: createHttpClient(),
      orderBookBatchSize: 499,
      ooV2Addresses: [oov2.address],
      ooV1Addresses: [oo.address],
    };
  };

  beforeEach(async function () {
    sandbox = sinon.createSandbox();
    [deployer] = (await ethers.getSigners()) as Signer[];

    const { finder, votingToken: vt, identifierWhitelist, collateralWhitelist } = (await (await import(
      "./fixtures/UmaEcosystem.Fixture"
    )).umaEcosystemFixture()) as {
      votingToken: VotingTokenEthers;
      finder: FinderEthers;
      identifierWhitelist: IdentifierWhitelistEthers;
      collateralWhitelist: any;
    };
    votingToken = vt;

    const defaultLiveness = 7200;
    oo = (await (await getContractFactory("OptimisticOracle", deployer)).deploy(
      defaultLiveness,
      finder.address,
      ZERO_ADDRESS
    )) as OptimisticOracleEthers;
    oov2 = (await (await getContractFactory("OptimisticOracleV2", deployer)).deploy(
      defaultLiveness,
      finder.address,
      ZERO_ADDRESS
    )) as OptimisticOracleV2Ethers;

    const multicall = await (await getContractFactory("Multicall3", deployer)).deploy();
    addGlobalHardhatTestingAddress("OptimisticOracle", oo.address);
    addGlobalHardhatTestingAddress("OptimisticOracleV2", oov2.address);
    addGlobalHardhatTestingAddress("Multicall3", multicall.address);

    await (await identifierWhitelist.addSupportedIdentifier(identifier)).wait();
    await (await votingToken.addMinter(await deployer.getAddress())).wait();
    await (await votingToken.mint(await deployer.getAddress(), ethers.utils.parseEther("10000000"))).wait();
    await (await votingToken.connect(deployer).approve(oov2.address, ethers.utils.parseEther("10000000"))).wait();
    // Ensure voting token is whitelisted as collateral for OO/OOV2 requests in case fixture alias differs.
    if (typeof collateralWhitelist.addToWhitelist === "function") {
      await (await collateralWhitelist.addToWhitelist(votingToken.address)).wait();
    } else if (typeof collateralWhitelist.whitelist === "function") {
      await (await collateralWhitelist.whitelist(votingToken.address)).wait();
    }

    // Default stubs common to all tests
    sandbox.stub(commonModule, "getPolymarketMarketInformation").resolves(marketInfo);
    sandbox.stub(commonModule, "getPolymarketOrderBooks").resolves(emptyBooks);
    sandbox.stub(commonModule, "getOrderFilledEvents").resolves([[], []]);
    sandbox.stub(commonModule, "getNotifiedProposals").resolves({});
  });

  afterEach(async function () {
    sandbox.restore();
  });

  function makeProposal(): OptimisticPriceRequest {
    return {
      proposalHash: "0xhash1",
      requester: "0xreq",
      proposer: (ethers.Wallet.createRandom().address),
      identifier,
      proposedPrice: ONE,
      requestTimestamp: ethers.BigNumber.from(Date.now()),
      proposalBlockNumber: 1,
      ancillaryData: ethers.utils.hexlify(ancillaryData),
      requestHash: "0xrequest",
      requestLogIndex: 0,
      proposalTimestamp: ethers.BigNumber.from(Date.now()),
      proposalExpirationTimestamp: ethers.BigNumber.from(Math.floor(Date.now() / 1000) + 3600),
      proposalLogIndex: 0,
    };
  }

  it("1) First check, no discrepancy → per-check + summary; flag set.", async function () {
    const params = await createMonitoringParams();
    const prop = makeProposal();
    sandbox.stub(commonModule, "getPolymarketProposedPriceRequestsOO").callsFake(async (_p, v) => (v === "v2" ? [prop] : []));

    const hasFirstOkStub = sandbox.stub(commonModule, "hasFirstOkLogged").resolves(false);
    const setFirstOkStub = sandbox.stub(commonModule, "setFirstOkLogged").resolves();

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    const spy = sinon.spy();
    const logger = createNewLogger([new SpyTransport({}, { spy })]);
    await monitorTransactionsProposedOrderBook(logger, params);

    // Expect two info logs: market_check + market_first_ok
    const infoLogs = spy
      .getCalls()
      .map((c) => extractMsg(c.lastArg))
      .filter((a) => a?.event === "market_check" || a?.event === "market_first_ok");
    assert.equal(infoLogs.length, 2);
    const checkLog = infoLogs.find((l) => l.event === "market_check");
    const okLog = infoLogs.find((l) => l.event === "market_first_ok");
    assert.deepInclude(checkLog, { at: "PolymarketMonitor", marketId: marketInfo[0].questionID, hasDiscrepancy: false });
    assert.deepInclude(okLog, { at: "PolymarketMonitor", marketId: marketInfo[0].questionID, consistentWithProposal: true });

    assert.isTrue(hasFirstOkStub.calledOnceWithExactly(marketInfo[0].questionID));
    assert.isTrue(setFirstOkStub.calledOnceWithExactly(marketInfo[0].questionID));
  });

  it("2) First check, with discrepancy → per-check only; no summary; no flag.", async function () {
    const params = await createMonitoringParams();
    const prop = makeProposal();
    sandbox.stub(commonModule, "getPolymarketProposedPriceRequestsOO").callsFake(async (_p, v) => (v === "v2" ? [prop] : []));

    // Create a discrepancy: winner side ask below threshold
    const books: Record<string, MarketOrderbook> = {
      [marketInfo[0].clobTokenIds[0]]: { bids: [], asks: [{ price: 0.5, size: 10 }] },
      [marketInfo[0].clobTokenIds[1]]: { bids: [], asks: [] },
    };
    (commonModule.getPolymarketOrderBooks as any).restore?.();
    sandbox.stub(commonModule, "getPolymarketOrderBooks").resolves(books);

    const hasFirstOkStub = sandbox.stub(commonModule, "hasFirstOkLogged").resolves(false);
    const setFirstOkStub = sandbox.stub(commonModule, "setFirstOkLogged");

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    const spy = sinon.spy();
    const logger = createNewLogger([new SpyTransport({}, { spy })]);
    await monitorTransactionsProposedOrderBook(logger, params);

    const checkLogs = spy.getCalls().map((c) => extractMsg(c.lastArg)).filter((a) => a?.event === "market_check");
    assert.equal(checkLogs.length, 1);
    assert.deepInclude(checkLogs[0], { marketId: marketInfo[0].questionID, hasDiscrepancy: true });
    assert.isTrue(hasFirstOkStub.notCalled);
    assert.isTrue(setFirstOkStub.notCalled);
  });

  it("3) Subsequent no-discrepancy with flag set → per-check only.", async function () {
    const params = await createMonitoringParams();
    const prop = makeProposal();
    sandbox.stub(commonModule, "getPolymarketProposedPriceRequestsOO").callsFake(async (_p, v) => (v === "v2" ? [prop] : []));

    sandbox.stub(commonModule, "hasFirstOkLogged").resolves(true);
    const setFirstOkStub = sandbox.stub(commonModule, "setFirstOkLogged");

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    const spy = sinon.spy();
    const logger = createNewLogger([new SpyTransport({}, { spy })]);
    await monitorTransactionsProposedOrderBook(logger, params);

    const infoLogs = spy.getCalls().map((c) => extractMsg(c.lastArg)).filter((a) => a?.event);
    const checkLogs = infoLogs.filter((l) => l.event === "market_check");
    const firstOkLogs = infoLogs.filter((l) => l.event === "market_first_ok");
    assert.equal(checkLogs.length, 1);
    assert.equal(firstOkLogs.length, 0);
    assert.isTrue(setFirstOkStub.notCalled);
  });

  it("4) Missing/partial data → summary logs available fields, no throw.", async function () {
    const params = await createMonitoringParams();
    const prop = makeProposal();
    sandbox.stub(commonModule, "getPolymarketProposedPriceRequestsOO").callsFake(async (_p, v) => (v === "v2" ? [prop] : []));
    sandbox.stub(commonModule, "hasFirstOkLogged").resolves(false);
    sandbox.stub(commonModule, "setFirstOkLogged").resolves();

    // No bids/asks and no trades -> ensure orderbookTop fields are null, lastTrades empty
    const spy = sinon.spy();
    const logger = createNewLogger([new SpyTransport({}, { spy })]);
    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);
    await monitorTransactionsProposedOrderBook(logger, params);

    const okLog = spy.getCalls().map((c) => extractMsg(c.lastArg)).find((a) => a?.event === "market_first_ok");
    assert.exists(okLog);
    assert.property(okLog, "orderbookTop");
    assert.deepEqual(okLog.orderbookTop, { bestBid: null, bestAsk: null });
    assert.deepEqual(okLog.lastTrades, []);
  });

  it("5) Key isolation → uses polymarket:first-ok-logged:${marketId}", async function () {
    const params = await createMonitoringParams();
    const prop = makeProposal();
    sandbox.stub(commonModule, "getPolymarketProposedPriceRequestsOO").callsFake(async (_p, v) => (v === "v2" ? [prop] : []));

    const key = commonModule.getFirstOkLoggedKey(marketInfo[0].questionID);
    assert.equal(key, `polymarket:first-ok-logged:${marketInfo[0].questionID}`);

    const hasFirstOkStub = sandbox.stub(commonModule, "hasFirstOkLogged").resolves(false);
    const setFirstOkStub = sandbox.stub(commonModule, "setFirstOkLogged").resolves();

    const spy = sinon.spy();
    const logger = createNewLogger([new SpyTransport({}, { spy })]);
    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);
    await monitorTransactionsProposedOrderBook(logger, params);

    assert.isTrue(hasFirstOkStub.calledWith(marketInfo[0].questionID));
    assert.isTrue(setFirstOkStub.calledWith(marketInfo[0].questionID));
  });
});
