import { addGlobalHardhatTestingAddress, ZERO_ADDRESS } from "@uma/common";
import {
  AddressWhitelistEthers,
  FinderEthers,
  IdentifierWhitelistEthers,
  OptimisticOracleV2Ethers,
  VotingTokenEthers,
} from "@uma/contracts-node";
import { createNewLogger, spyLogIncludes, spyLogLevel, SpyTransport } from "@uma/financial-templates-lib";
import { assert } from "chai";
import sinon from "sinon";
import * as commonModule from "../src/monitor-polymarket/common";
import {
  getMarketKeyToStore,
  MarketOrderbook,
  MonitoringParams,
  PolymarketMarketGraphqlProcessed,
  PolymarketTradeInformation,
} from "../src/monitor-polymarket/common";
import { monitorTransactionsProposedOrderBook } from "../src/monitor-polymarket/MonitorProposalsOrderBook";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { formatBytes32String, getContractFactory, hre, Provider, Signer, toUtf8Bytes } from "./utils";
import { tryHexToUtf8String } from "../src/utils/contracts";

const ethers = hre.ethers;

describe("PolymarketNotifier", function () {
  let sandbox: sinon.SinonSandbox;
  let oov2: OptimisticOracleV2Ethers;
  let deployer: Signer;
  let votingToken: VotingTokenEthers;
  let getNotifiedProposalsStub: sinon.SinonStub;
  const identifier = formatBytes32String("TEST_IDENTIFIER");
  const ancillaryData = toUtf8Bytes(`q:"Really hard question, maybe 100, maybe 90?"`);

  const ONE = ethers.utils.parseEther("1");

  const marketInfo: PolymarketMarketGraphqlProcessed = {
    clobTokenIds: ["0x1234", "0x1234"],
    volumeNum: 200_000,
    outcomes: ["Yes", "No"],
    outcomePrices: ["1", "0"],
    question: "Will NATO expand by June 30?",
  };

  const emptyOrders: [MarketOrderbook, MarketOrderbook] = [
    {
      bids: [],
      asks: [],
    },
    {
      bids: [],
      asks: [],
    },
  ];

  const emptyTradeInformation: [PolymarketTradeInformation[], PolymarketTradeInformation[]] = [[], []];

  // Create monitoring params for single block to pass to monitor modules.
  const createMonitoringParams = async (): Promise<MonitoringParams> => {
    const binaryAdapterAddress = "0x1234";
    const ctfAdapterAddress = await deployer.getAddress();
    const ctfAdapterAddressV2 = "0x1234";
    const ctfExchangeAddress = "0x1234";
    const graphqlEndpoint = "endpoint";
    const apiEndpoint = "endpoint";

    return {
      binaryAdapterAddress,
      ctfAdapterAddress,
      ctfAdapterAddressV2,
      ctfExchangeAddress,
      maxBlockLookBack: 3499,
      graphqlEndpoint,
      apiEndpoint,
      provider: ethers.provider as Provider,
      chainId: (await ethers.provider.getNetwork()).chainId,
      pollingDelay: 0,
      polymarketApiKey: "key",
      unknownProposalNotificationInterval: 1800,
    };
  };

  beforeEach(async function () {
    sandbox = sinon.createSandbox();

    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [deployer] = (await ethers.getSigners()) as Signer[];

    // Get contract instances.
    const { finder, votingToken: vt, identifierWhitelist, collateralWhitelist } = (await umaEcosystemFixture()) as {
      votingToken: VotingTokenEthers;
      finder: FinderEthers;
      identifierWhitelist: IdentifierWhitelistEthers;
      collateralWhitelist: AddressWhitelistEthers;
    };
    votingToken = vt;
    const defaultLiveness = 7200; // 2 hours

    const oo = (await (await getContractFactory("OptimisticOracle", deployer)).deploy(
      defaultLiveness,
      finder.address,
      ZERO_ADDRESS
    )) as OptimisticOracleV2Ethers;
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
    await (await collateralWhitelist.addToWhitelist(votingToken.address)).wait();

    const getNotifiedProposalsMock = sandbox.stub();
    getNotifiedProposalsMock.returns({});
    getNotifiedProposalsStub = sandbox.stub(commonModule, "getNotifiedProposals").callsFake(getNotifiedProposalsMock);

    const storeNotifiedProposalsMock = sandbox.stub();
    storeNotifiedProposalsMock.returns({});
    sandbox.stub(commonModule, "storeNotifiedProposals").callsFake(storeNotifiedProposalsMock);

    // Fund staker and stake tokens.
    const TEN_MILLION = ethers.utils.parseEther("10000000");
    await (await votingToken.addMinter(await deployer.getAddress())).wait();
    await (await votingToken.mint(await deployer.getAddress(), TEN_MILLION)).wait();
    await (await votingToken.connect(deployer).approve(oov2.address, TEN_MILLION)).wait();
  });

  afterEach(async function () {
    sandbox.restore();
  });

  function mockFunctionWithReturnValue(functionName, mockValue) {
    const mockDataFunction = sandbox.stub();
    mockDataFunction.returns(mockValue);
    sandbox.stub(commonModule, functionName).callsFake(mockDataFunction);
  }

  function mockFunctionThrowsError(functionName, errorMessage = "Mock error") {
    const mockDataFunction = sandbox.stub();
    mockDataFunction.throws(new Error(errorMessage));
    sandbox.stub(commonModule, functionName).callsFake(mockDataFunction);
  }

  it("It should notify if there are orders over the threshold", async function () {
    const orders: [MarketOrderbook, MarketOrderbook] = [
      {
        bids: [],
        asks: [
          {
            price: 0.9,
            size: 100,
          },
        ],
      },
      {
        bids: [],
        asks: [],
      },
    ];

    mockFunctionWithReturnValue("getPolymarketOrderBook", orders);
    mockFunctionWithReturnValue("getPolymarketMarketInformation", marketInfo);
    mockFunctionWithReturnValue("getOrderFilledEvents", emptyTradeInformation);

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // The spy should have been called as the order book is not empty.
    assert.equal(spy.callCount, 1);
    assert.equal(spy.getCall(0).lastArg.at, "PolymarketMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Difference between proposed price and market signal! 🚨");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(
      spyLogIncludes(spy, 0, ` Someone is trying to sell 100 winner outcome tokens at a price of 0.9 on the orderbook.`)
    ); // price
    assert.equal(spy.getCall(0).lastArg.notificationPath, "polymarket-notifier");
  });
  it("It should not notify if order book is empty", async function () {
    mockFunctionWithReturnValue("getPolymarketOrderBook", emptyOrders);
    mockFunctionWithReturnValue("getPolymarketMarketInformation", marketInfo);
    mockFunctionWithReturnValue("getOrderFilledEvents", emptyTradeInformation);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // The spy should not have been called as the order book is empty.
    assert.equal(spy.callCount, 0);
  });
  it("It should notify if there are sell trades over the threshold", async function () {
    const orderFilledEvents: [PolymarketTradeInformation[], PolymarketTradeInformation[]] = [
      [
        {
          price: 0.9,
          type: "sell",
          amount: 100,
          timestamp: 123,
        },
      ],
      [],
    ];
    mockFunctionWithReturnValue("getPolymarketOrderBook", emptyOrders);
    mockFunctionWithReturnValue("getPolymarketMarketInformation", marketInfo);
    mockFunctionWithReturnValue("getOrderFilledEvents", orderFilledEvents);

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // The spy should have been called as the order book is not empty.
    assert.equal(spy.callCount, 1);
    assert.equal(spy.getCall(0).lastArg.at, "PolymarketMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Difference between proposed price and market signal! 🚨");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(
      spy
        .getCall(0)
        .toString()
        .includes(
          ` Someone sold winner outcome tokens at a price below the threshold. These are the trades: ${JSON.stringify(
            orderFilledEvents[0]
          )}`
        )
    ); // price
    assert.equal(spy.getCall(0).lastArg.notificationPath, "polymarket-notifier");
  });
  it("It should notify if there are buy trades over the threshold", async function () {
    const orderFilledEvents: [PolymarketTradeInformation[], PolymarketTradeInformation[]] = [
      [],
      [
        {
          price: 0.1,
          type: "buy",
          amount: 100,
          timestamp: 123,
        },
      ],
    ];
    mockFunctionWithReturnValue("getPolymarketOrderBook", emptyOrders);
    mockFunctionWithReturnValue("getPolymarketMarketInformation", marketInfo);
    mockFunctionWithReturnValue("getOrderFilledEvents", orderFilledEvents);

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // The spy should have been called as the order book is not empty.
    assert.equal(spy.callCount, 1);
    assert.equal(spy.getCall(0).lastArg.at, "PolymarketMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Difference between proposed price and market signal! 🚨");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(
      spy
        .getCall(0)
        .toString()
        .includes(
          ` Someone bought loser outcome tokens at a price above the threshold. These are the trades: ${JSON.stringify(
            orderFilledEvents[1]
          )}`
        )
    ); // price
    assert.equal(spy.getCall(0).lastArg.notificationPath, "polymarket-notifier");
  });
  it("It should notify if there are proposals with high volume", async function () {
    mockFunctionWithReturnValue("getPolymarketOrderBook", emptyOrders);
    mockFunctionWithReturnValue("getPolymarketMarketInformation", { ...marketInfo, volumeNum: 2_000_000 });
    mockFunctionWithReturnValue("getOrderFilledEvents", emptyTradeInformation);

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // The spy should have been called as the order book is not empty.
    assert.equal(spy.callCount, 1);
    assert.equal(spy.getCall(0).lastArg.at, "PolymarketMonitor");
    assert.equal(
      spy.getCall(0).lastArg.message,
      "A market with high volume has been proposed and needs to be checked! 🚨"
    );
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.equal(spy.getCall(0).lastArg.notificationPath, "polymarket-notifier");
  });
  it("It should notify if market polymarket information is not found", async function () {
    mockFunctionWithReturnValue("getPolymarketOrderBook", emptyOrders);
    mockFunctionWithReturnValue("getOrderFilledEvents", emptyTradeInformation);
    mockFunctionThrowsError("getPolymarketMarketInformation");

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // The spy should have been called as the market adapter is unknown.
    assert.equal(spy.callCount, 1);
    assert.equal(spy.getCall(0).lastArg.at, "PolymarketMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Failed to verify proposed market, please verify manually! 🚨");
    assert.equal(spyLogLevel(spy, 0), "error");
    assert.isTrue(spy.getCall(0).toString().includes(`Failed to verify market:`));
    assert.isTrue(
      spy
        .getCall(0)
        .toString()
        .includes(` Ancillary data: ${tryHexToUtf8String(ethers.utils.hexlify(ancillaryData))}.`)
    );
    assert.equal(spy.getCall(0).lastArg.notificationPath, "polymarket-notifier");
  });
  it("It should not notify if already notified", async function () {
    sandbox.restore();
    const orderFilledEvents: [PolymarketTradeInformation[], PolymarketTradeInformation[]] = [
      [],
      [
        {
          price: 0.1,
          type: "buy",
          amount: 100,
          timestamp: 123,
        },
      ],
    ];
    mockFunctionWithReturnValue("getPolymarketOrderBook", emptyOrders);
    mockFunctionWithReturnValue("getPolymarketMarketInformation", marketInfo);
    mockFunctionWithReturnValue("getOrderFilledEvents", orderFilledEvents);

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    const tx = await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    getNotifiedProposalsStub.restore();
    const getNotifiedProposalsMock = sandbox.stub();
    getNotifiedProposalsMock.returns({
      [getMarketKeyToStore({ proposalHash: tx.hash })]: { proposalHash: tx.hash },
    });
    sandbox.stub(commonModule, "getNotifiedProposals").callsFake(getNotifiedProposalsMock);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // The spy should not have been called as the market adapter is unknown and was already notified.
    assert.equal(spy.callCount, 0);
  });
  it("It should notify two times if there are buy trades over the threshold and it's a high volume market proposal", async function () {
    const orderFilledEvents: [PolymarketTradeInformation[], PolymarketTradeInformation[]] = [
      [
        {
          price: 0.9,
          type: "sell",
          amount: 100,
          timestamp: 123,
        },
      ],
      [],
    ];

    mockFunctionWithReturnValue("getPolymarketOrderBook", emptyOrders);
    mockFunctionWithReturnValue("getPolymarketMarketInformation", { ...marketInfo, volumeNum: 2_000_000 });
    mockFunctionWithReturnValue("getOrderFilledEvents", orderFilledEvents);

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // The spy should have been called 2 times
    assert.equal(spy.callCount, 2);
  });
});
