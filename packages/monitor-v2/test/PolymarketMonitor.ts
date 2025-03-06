import "@nomiclabs/hardhat-ethers";
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
  encodeMultipleQuery,
  getMarketKeyToStore,
  MarketOrderbook,
  MonitoringParams,
  OptimisticPriceRequest,
  PolymarketMarketGraphqlProcessed,
  PolymarketTradeInformation,
} from "../src/monitor-polymarket/common";
import { monitorTransactionsProposedOrderBook } from "../src/monitor-polymarket/MonitorProposalsOrderBook";
import { tryHexToUtf8String } from "../src/utils/contracts";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { formatBytes32String, getContractFactory, hre, Provider, Signer, toUtf8Bytes } from "./utils";
const ethers = hre.ethers;

type CommonModuleFunctions = keyof typeof commonModule;

describe("PolymarketNotifier", function () {
  let sandbox: sinon.SinonSandbox;
  let oov2: OptimisticOracleV2Ethers;
  let deployer: Signer;
  let votingToken: VotingTokenEthers;
  let getNotifiedProposalsStub: sinon.SinonStub;
  const identifier = formatBytes32String("TEST_IDENTIFIER");
  const ancillaryData = toUtf8Bytes(`q:"Really hard question, maybe 100, maybe 90?"`);

  const ONE = ethers.utils.parseEther("1");

  const marketInfo: PolymarketMarketGraphqlProcessed[] = [
    {
      clobTokenIds: ["0x1234", "0x1234"],
      volumeNum: 200_000,
      outcomes: ["Yes", "No"],
      outcomePrices: ["1", "0"],
      question: "Will NATO expand by June 30?",
    },
  ];

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
    const ctfSportsOracleAddress = "0x1234";
    const graphqlEndpoint = "endpoint";
    const apiEndpoint = "endpoint";

    return {
      binaryAdapterAddress,
      ctfAdapterAddress,
      ctfAdapterAddressV2,
      ctfExchangeAddress,
      ctfSportsOracleAddress,
      maxBlockLookBack: 3499,
      graphqlEndpoint,
      apiEndpoint,
      provider: ethers.provider as Provider,
      chainId: (await ethers.provider.getNetwork()).chainId,
      pollingDelay: 0,
      polymarketApiKey: "key",
      unknownProposalNotificationInterval: 1800,
      retryAttempts: 3,
      retryDelayMs: 1000,
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

  function mockFunctionWithReturnValue(functionName: CommonModuleFunctions, mockValue: any) {
    const mockDataFunction = sandbox.stub();
    mockDataFunction.returns(mockValue);
    sandbox.stub(commonModule, functionName).callsFake(mockDataFunction);
  }

  function mockFunctionThrowsError(functionName: CommonModuleFunctions, errorMessage = "Mock error") {
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

    // Call monitorTransactionsProposedOrderBook for the block when the assertion was made.
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
    );
    assert.equal(spy.getCall(0).lastArg.notificationPath, "polymarket-notifier");
  });

  it("It should not notify if order book is empty", async function () {
    mockFunctionWithReturnValue("getPolymarketOrderBook", emptyOrders);
    mockFunctionWithReturnValue("getPolymarketMarketInformation", marketInfo);
    mockFunctionWithReturnValue("getOrderFilledEvents", emptyTradeInformation);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // No notifications should be logged.
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

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

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
    );
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

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

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
    );
    assert.equal(spy.getCall(0).lastArg.notificationPath, "polymarket-notifier");
  });

  it("It should notify if there are proposals with high volume", async function () {
    mockFunctionWithReturnValue("getPolymarketOrderBook", emptyOrders);
    mockFunctionWithReturnValue("getPolymarketMarketInformation", [{ ...marketInfo, volumeNum: 2_000_000 }]);
    mockFunctionWithReturnValue("getOrderFilledEvents", emptyTradeInformation);

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

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
    mockFunctionThrowsError("getPolymarketMarketInformation", "Market not found");

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

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

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // Already notified proposals should not trigger any logs.
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
    mockFunctionWithReturnValue("getPolymarketMarketInformation", [{ ...marketInfo, volumeNum: 2_000_000 }]);
    mockFunctionWithReturnValue("getOrderFilledEvents", orderFilledEvents);

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // Expect two notifications due to both orderbook and trade event triggers.
    assert.equal(spy.callCount, 2);
  });

  describe("Sports Market Notifications", function () {
    const sportsAncillaryData = ethers.utils.hexlify(
      ethers.utils.toUtf8Bytes(
        JSON.stringify({
          title: "Los Angeles Lakers vs Boston Celtics",
          description:
            'Final scores for the "Los Angeles Lakers" vs "Boston Celtics" NBA game scheduled for Jan 7, 2025.',
          labels: ["Lakers", "Celtics"],
        })
      )
    );

    it("should notify for a winner sports market", async function () {
      const params = await createMonitoringParams();
      // We are proposing Lakers 60, Celtics 50
      const proposedPrice = encodeMultipleQuery(["60", "50"]);
      const sportsProposal: OptimisticPriceRequest = {
        proposalHash: "0xvalidsports",
        requester: params.ctfSportsOracleAddress,
        proposedPrice,
        requestTimestamp: ethers.BigNumber.from(Date.now()),
        requestBlockNumber: 12345,
        ancillaryData: sportsAncillaryData,
        requestHash: "0xrequesthash",
        requestLogIndex: 0,
        proposalTimestamp: ethers.BigNumber.from(Date.now()),
        proposalExpirationTimestamp: ethers.BigNumber.from(Date.now() + 1000 * 60 * 60 * 24),
        proposalLogIndex: 0,
      };

      const stubProposals = sandbox
        .stub(commonModule, "getPolymarketProposedPriceRequestsOO")
        .resolves([sportsProposal]);

      // Fake sports market data for a Winner market.
      const fakeSportsMarketData = {
        marketType: commonModule.MarketType.Winner,
        ordering: commonModule.Ordering.HomeVsAway,
        underdog: 0, // Not used in Winner market
        line: ethers.BigNumber.from("0"), // Not used in Winner market
      };
      const contractStub = sandbox.stub(commonModule, "getSportsMarketData").resolves(fakeSportsMarketData);

      // The winning side is the Home team so selling tokens[0] is not profitable.
      const sportsOrderBook: [MarketOrderbook, MarketOrderbook] = [
        {
          bids: [],
          asks: [
            {
              price: 0.9, // below threshold (THRESHOLD_ASKS default 1)
              size: 100,
            },
          ],
        },
        {
          bids: [],
          asks: [],
        },
      ];
      mockFunctionWithReturnValue("getPolymarketOrderBook", sportsOrderBook);
      mockFunctionWithReturnValue("getOrderFilledEvents", emptyTradeInformation);
      mockFunctionWithReturnValue("getPolymarketMarketInformation", marketInfo);

      const spy = sinon.spy();
      const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
      await monitorTransactionsProposedOrderBook(spyLogger, params);

      // We expect a notification for the sports market due to the order book entry.
      assert.isAbove(spy.callCount, 0);
      const logMsg = spy.getCall(0).lastArg;
      assert.equal(logMsg.at, "PolymarketMonitor");
      assert.equal(logMsg.notificationPath, "polymarket-notifier");
      assert.include(logMsg.mrkdwn, 'A price was proposed for the game "Los Angeles Lakers vs Boston Celtics"');
      assert.include(logMsg.mrkdwn, "The final scores reported were: Lakers: 60 and Celtics: 50");
      assert.include(
        logMsg.mrkdwn,
        "Someone is trying to sell 100 winner outcome tokens at a price of 0.9 on the orderbook"
      );

      stubProposals.restore();
      contractStub.restore();
    });
  });
});
