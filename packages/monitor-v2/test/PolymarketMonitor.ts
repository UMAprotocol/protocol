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
  getProposalKeyToStore,
  getSportsPayouts,
  MarketOrderbook,
  MarketType,
  MonitoringParams,
  OptimisticPriceRequest,
  Ordering,
  PolymarketMarketGraphqlProcessed,
  PolymarketTradeInformation,
  Underdog,
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
      checkBeforeExpirationSeconds: Date.now() + 1000 * 60 * 60 * 24,
      fillEventsLookbackSeconds: 0,
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
    const params = await createMonitoringParams();

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

    // Create a mock proposal
    const mockProposal: OptimisticPriceRequest = {
      proposalHash: "0xordertest",
      requester: params.ctfAdapterAddress,
      proposer: await deployer.getAddress(),
      identifier: "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000", // YES_OR_NO_QUERY
      proposedPrice: ONE,
      requestTimestamp: ethers.BigNumber.from(Date.now()),
      proposalBlockNumber: 12345,
      ancillaryData: ethers.utils.hexlify(ancillaryData),
      requestHash: "0xrequesthash",
      requestLogIndex: 0,
      proposalTimestamp: ethers.BigNumber.from(Date.now()),
      proposalExpirationTimestamp: ethers.BigNumber.from(Date.now() + 1000 * 60 * 60 * 24),
      proposalLogIndex: 0,
    };

    // Mock getPolymarketProposedPriceRequestsOO to return our mock proposal
    sandbox.stub(commonModule, "getPolymarketProposedPriceRequestsOO").callsFake(async (params, version) => {
      return version === "v2" ? [mockProposal] : [];
    });

    mockFunctionWithReturnValue("getPolymarketOrderBook", orders);
    mockFunctionWithReturnValue("getPolymarketMarketInformation", marketInfo);
    mockFunctionWithReturnValue("getOrderFilledEvents", emptyTradeInformation);

    await oov2.requestPrice(identifier, 1, ancillaryData, votingToken.address, 0);
    await oov2.proposePrice(await deployer.getAddress(), identifier, 1, ancillaryData, ONE);

    // Call monitorTransactionsProposedOrderBook for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, params);

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

  it("It should ignore 3rd party proposals when 'No market found' error occurs and >=2 criteria are met", async function () {
    const params = await createMonitoringParams();
    const proposerAddress = await deployer.getAddress();

    // Create ancillary data with initializer that matches proposer (to trigger criteria 3)
    const ancillaryDataWithInitializer = `q:"Really hard question, maybe 100, maybe 90?" initializer:${proposerAddress}`;
    const ancillaryDataHex = ethers.utils.hexlify(ethers.utils.toUtf8Bytes(ancillaryDataWithInitializer));

    // Create a mock proposal
    const mockProposal: OptimisticPriceRequest = {
      proposalHash: "0xmockproposal",
      requester: params.ctfAdapterAddress,
      proposer: proposerAddress,
      identifier: "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000", // YES_OR_NO_QUERY
      proposedPrice: ONE,
      requestTimestamp: ethers.BigNumber.from(Date.now()),
      proposalBlockNumber: 12345,
      ancillaryData: ancillaryDataHex,
      requestHash: "0xrequesthash",
      requestLogIndex: 0,
      proposalTimestamp: ethers.BigNumber.from(Date.now()),
      proposalExpirationTimestamp: ethers.BigNumber.from(Date.now() + 1000 * 60 * 60 * 24),
      proposalLogIndex: 0,
    };

    // Mock getPolymarketProposedPriceRequestsOO to return our mock proposal only for v2
    sandbox.stub(commonModule, "getPolymarketProposedPriceRequestsOO").callsFake(async (params, version) => {
      return version === "v2" ? [mockProposal] : [];
    });

    mockFunctionWithReturnValue("getPolymarketOrderBook", emptyOrders);
    mockFunctionWithReturnValue("getOrderFilledEvents", emptyTradeInformation);

    // Calculate the actual questionID that will be generated from our ancillary data
    const expectedQuestionID = ethers.utils.keccak256(ancillaryDataHex);
    mockFunctionThrowsError("getPolymarketMarketInformation", `No market found for question ID: ${expectedQuestionID}`);

    // Mock getRewardForProposal to return 0 (criteria 1 met)
    mockFunctionWithReturnValue("getRewardForProposal", ethers.BigNumber.from(0));

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, params);

    // Should only have an info log for ignoring the proposal, no error notifications
    assert.equal(spy.callCount, 1);
    assert.equal(spy.getCall(0).lastArg.at, "PolymarketMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Ignoring 3rd party Polymarket proposal based on filtering criteria");
    assert.equal(spyLogLevel(spy, 0), "info");
  });

  it("It should still notify when 'No market found' error occurs but <2 criteria are met", async function () {
    const params = await createMonitoringParams();

    // Create a mock proposal
    const mockProposal: OptimisticPriceRequest = {
      proposalHash: "0xmockproposal2",
      requester: params.ctfAdapterAddress,
      proposer: await deployer.getAddress(),
      identifier: "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000", // YES_OR_NO_QUERY
      proposedPrice: ONE,
      requestTimestamp: ethers.BigNumber.from(Date.now()),
      proposalBlockNumber: 12345,
      ancillaryData: ethers.utils.hexlify(ancillaryData),
      requestHash: "0xrequesthash2",
      requestLogIndex: 0,
      proposalTimestamp: ethers.BigNumber.from(Date.now()),
      proposalExpirationTimestamp: ethers.BigNumber.from(Date.now() + 1000 * 60 * 60 * 24),
      proposalLogIndex: 0,
    };

    // Mock getPolymarketProposedPriceRequestsOO to return our mock proposal only for v2
    sandbox.stub(commonModule, "getPolymarketProposedPriceRequestsOO").callsFake(async (params, version) => {
      return version === "v2" ? [mockProposal] : [];
    });

    mockFunctionWithReturnValue("getPolymarketOrderBook", emptyOrders);
    mockFunctionWithReturnValue("getOrderFilledEvents", emptyTradeInformation);

    // Calculate the actual questionID that will be generated from our ancillary data
    const expectedQuestionID = ethers.utils.keccak256(ethers.utils.hexlify(ancillaryData));
    mockFunctionThrowsError("getPolymarketMarketInformation", `No market found for question ID: ${expectedQuestionID}`);

    // Mock getRewardForProposal to return non-zero (criteria 1 NOT met)
    mockFunctionWithReturnValue("getRewardForProposal", ethers.BigNumber.from(100));

    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, params);

    // Should still get the normal error notification
    assert.equal(spy.callCount, 1);
    assert.equal(spy.getCall(0).lastArg.at, "PolymarketMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Failed to verify proposed market, please verify manually! 🚨");
    assert.equal(spyLogLevel(spy, 0), "error");
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
      [getProposalKeyToStore({ proposalHash: tx.hash })]: { proposalHash: tx.hash },
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

    // The spy should have been called 2 times
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

    it("should notify for a sports market", async function () {
      const params = await createMonitoringParams();
      // We are proposing Lakers 60, Celtics 50
      const proposedPrice = encodeMultipleQuery(["60", "50"]);
      const sportsProposal: OptimisticPriceRequest = {
        proposalHash: "0xvalidsports",
        requester: params.ctfSportsOracleAddress,
        proposer: await deployer.getAddress(),
        identifier: "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000", // YES_OR_NO_QUERY
        proposedPrice,
        requestTimestamp: ethers.BigNumber.from(Date.now()),
        proposalBlockNumber: 12345,
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

    describe("getSportsPayouts", () => {
      describe("Spreads Market", () => {
        it("should return [0,1] when underdog (home) wins by having a higher score", () => {
          // Market configuration: spreads market where home is the underdog.
          // For HomeVsAway ordering, the proposedPrice encodes: home score at index 0, away score at index 1.
          // Let line = 10.5 (after dividing by 1e6) and use scores home = 50, away = 40.
          const market = {
            marketType: MarketType.Spreads,
            ordering: Ordering.HomeVsAway,
            underdog: Underdog.Home,
            line: ethers.utils.parseUnits("10.5", 6), // represents a line of 10.5
          };
          const proposedPrice = encodeMultipleQuery(["50", "40"]);
          const payouts = getSportsPayouts(market, proposedPrice);
          // For a spreads market when the underdog wins, the function returns [0, 1]
          assert.deepEqual(payouts, [0, 1]);
        });

        it("should return [0,1] when underdog (home) wins because the spread is within the line", () => {
          // Even if home is lower than away, if the difference is within the allowed line the underdog wins.
          const market = {
            marketType: MarketType.Spreads,
            ordering: Ordering.HomeVsAway,
            underdog: Underdog.Home,
            line: ethers.utils.parseUnits("10.5", 6), // line of 10.5
          };
          // Use scores: home = 30, away = 35 (difference 5 <= 10.5)
          const proposedPrice = encodeMultipleQuery(["30", "35"]);
          const payouts = getSportsPayouts(market, proposedPrice);
          assert.deepEqual(payouts, [0, 1]);
        });

        it("should return [1,0] when underdog (home) loses because the spread exceeds the line", () => {
          // With the same market configuration but a tighter line, the favorite wins.
          const market = {
            marketType: MarketType.Spreads,
            ordering: Ordering.HomeVsAway,
            underdog: Underdog.Home,
            line: ethers.utils.parseUnits("5.5", 6), // line of 5.5
          };
          // Use scores: home = 30, away = 40 (difference 10 > 5.5)
          const proposedPrice = encodeMultipleQuery(["30", "40"]);
          const payouts = getSportsPayouts(market, proposedPrice);
          assert.deepEqual(payouts, [1, 0]);
        });

        it("should return [0,1] when underdog (away) wins", () => {
          // For a spreads market where away is the underdog.
          const market = {
            marketType: MarketType.Spreads,
            ordering: Ordering.HomeVsAway,
            underdog: Underdog.Away,
            line: ethers.utils.parseUnits("10.5", 6), // line of 10.5
          };
          // For Underdog = Away, the decoding swaps the scores:
          // Use scores: home = 40, away = 50 (thus underdogScore = 50, favoriteScore = 40)
          const proposedPrice = encodeMultipleQuery(["40", "50"]);
          const payouts = getSportsPayouts(market, proposedPrice);
          assert.deepEqual(payouts, [0, 1]);
        });

        it("should return [1,0] when underdog (away) loses because the spread exceeds the line", () => {
          const market = {
            marketType: MarketType.Spreads,
            ordering: Ordering.HomeVsAway,
            underdog: Underdog.Away,
            line: ethers.utils.parseUnits("5.5", 6), // line of 5.5
          };
          // Use scores: home = 50, away = 40 (for away as underdog, this means underdogScore = 40 and favoriteScore = 50)
          const proposedPrice = encodeMultipleQuery(["50", "40"]);
          const payouts = getSportsPayouts(market, proposedPrice);
          assert.deepEqual(payouts, [1, 0]);
        });
      });

      describe("Totals Market", () => {
        it("should return [0,1] when the total is less than or equal to the line (favoring Under)", () => {
          // For totals markets, the outcomes are always: ["Under", "Over"].
          const market = {
            marketType: MarketType.Totals,
            ordering: Ordering.HomeVsAway, // ordering is irrelevant here
            underdog: Underdog.Home, // not used in totals
            line: ethers.utils.parseUnits("100.5", 6), // line of 100.5
          };
          // Use scores: home = 40, away = 50, so total = 90 which is <= 100.5.
          const proposedPrice = encodeMultipleQuery(["40", "50"]);
          const payouts = getSportsPayouts(market, proposedPrice);
          assert.deepEqual(payouts, [0, 1]);
        });

        it("should return [1,0] when the total is greater than the line (favoring Over)", () => {
          const market = {
            marketType: MarketType.Totals,
            ordering: Ordering.HomeVsAway,
            underdog: Underdog.Home,
            line: ethers.utils.parseUnits("100.5", 6), // line of 100.5
          };
          // Use scores: home = 60, away = 50, so total = 110 > 100.5.
          const proposedPrice = encodeMultipleQuery(["60", "50"]);
          const payouts = getSportsPayouts(market, proposedPrice);
          assert.deepEqual(payouts, [1, 0]);
        });
      });

      describe("Winner Market", () => {
        it("should return [1,1] when scores are equal (draw)", () => {
          const market = {
            marketType: MarketType.Winner,
            ordering: Ordering.HomeVsAway, // ordering does not affect a draw
            underdog: Underdog.Home, // not used in Winner markets
            line: ethers.BigNumber.from("0"), // not used in Winner markets
          };
          const proposedPrice = encodeMultipleQuery(["50", "50"]);
          const payouts = getSportsPayouts(market, proposedPrice);
          assert.deepEqual(payouts, [1, 1]);
        });

        it("should return [1,0] for HomeVsAway ordering when home wins", () => {
          const market = {
            marketType: MarketType.Winner,
            ordering: Ordering.HomeVsAway,
            underdog: Underdog.Home,
            line: ethers.BigNumber.from("0"),
          };
          const proposedPrice = encodeMultipleQuery(["60", "50"]); // home > away
          const payouts = getSportsPayouts(market, proposedPrice);
          assert.deepEqual(payouts, [1, 0]);
        });

        it("should return [0,1] for HomeVsAway ordering when away wins", () => {
          const market = {
            marketType: MarketType.Winner,
            ordering: Ordering.HomeVsAway,
            underdog: Underdog.Home,
            line: ethers.BigNumber.from("0"),
          };
          const proposedPrice = encodeMultipleQuery(["40", "50"]); // home < away
          const payouts = getSportsPayouts(market, proposedPrice);
          assert.deepEqual(payouts, [0, 1]);
        });

        it("should return [0,1] for AwayVsHome ordering when home wins", () => {
          const market = {
            marketType: MarketType.Winner,
            ordering: Ordering.AwayVsHome,
            underdog: Underdog.Home,
            line: ethers.BigNumber.from("0"),
          };
          const proposedPrice = encodeMultipleQuery(["50", "60"]); // home > away
          const payouts = getSportsPayouts(market, proposedPrice);
          assert.deepEqual(payouts, [0, 1]);
        });

        it("should return [1,0] for AwayVsHome ordering when away wins", () => {
          const market = {
            marketType: MarketType.Winner,
            ordering: Ordering.AwayVsHome,
            underdog: Underdog.Home,
            line: ethers.BigNumber.from("0"),
          };
          const proposedPrice = encodeMultipleQuery(["50", "40"]); // home < away
          const payouts = getSportsPayouts(market, proposedPrice);
          assert.deepEqual(payouts, [1, 0]);
        });
      });
    });
  });

  it("getOrderFilledEvents uses the fillEventsLookbackSeconds", async function () {
    const currentBlock = 100_000;
    const fillEventsLookbackSeconds = 3_600; // 1 hour
    const proposalBlockNumber = 95_000; // anchor block

    const params = await createMonitoringParams();
    params.fillEventsLookbackSeconds = fillEventsLookbackSeconds;

    const providerStub = new ethers.providers.JsonRpcProvider();
    sandbox.stub(providerStub, "getBlockNumber").resolves(currentBlock);
    params.provider = providerStub as any;

    const lookbackBlocks = Math.round((fillEventsLookbackSeconds * commonModule.POLYGON_BLOCKS_PER_HOUR) / 3_600);
    const fromBlockParam = Math.max(proposalBlockNumber, currentBlock - lookbackBlocks);

    let capturedFromBlock: number | undefined;
    sandbox.stub(commonModule, "paginatedEventQuery").callsFake(async (_c, _f, searchConfig) => {
      capturedFromBlock = searchConfig.fromBlock;
      return [];
    });

    sandbox.stub(ethers, "Contract").returns({ filters: { OrderFilled: () => ({ topics: [] }) } } as any);

    await commonModule.getOrderFilledEvents(params, ["0xdeadbeef", "0xfeedface"], fromBlockParam);

    assert.equal(
      capturedFromBlock,
      fromBlockParam,
      "`fromBlock` passed to paginatedEventQuery must equal the caller-computed value"
    );
  });

  describe("getPolymarketProposedPriceRequestsOO Filtering", function () {
    it("should return only events that are close enough to expiration (current time > expirationTimestamp - checkBeforeExpirationSeconds)", async function () {
      const fakeRequester = "0x0000000000000000000000000000000000000000"; // Address 0
      // Set a fixed current time (in seconds)
      const fakeTime = 1600000000;
      // Stub Date.now() to return fakeTime * 1000
      const dateNowStub = sandbox.stub(Date, "now").returns(fakeTime * 1000);

      const identifier = formatBytes32String("TEST_IDENTIFIER");
      const ancillaryData = formatBytes32String("data");

      const blockNumber = await ethers.provider.getBlockNumber();
      // Create two fake events:
      // Event 1: expires at fakeTime + 100 seconds.
      // Calculation: (fakeTime + 100) - 120 = fakeTime - 20, so current time (fakeTime) > fakeTime - 20 => condition satisfied.
      const fakeEventBelow = {
        transactionHash: "0xeventBelow",
        logIndex: 0,
        blockNumber,
        args: {
          requester: fakeRequester,
          expirationTimestamp: ethers.BigNumber.from(fakeTime + 100),
          timestamp: ethers.BigNumber.from(fakeTime - 50),
          ancillaryData,
          proposedPrice: ethers.BigNumber.from(123),
          identifier,
        },
      };
      // Event 2: expires at fakeTime + 200 seconds.
      // Calculation: (fakeTime + 200) - 120 = fakeTime + 80, so current time (fakeTime) is NOT > fakeTime + 80 => condition fails.
      const fakeEventAbove = {
        transactionHash: "0xeventAbove",
        logIndex: 0,
        blockNumber: 90,
        args: {
          requester: fakeRequester,
          expirationTimestamp: ethers.BigNumber.from(fakeTime + 200),
          timestamp: ethers.BigNumber.from(fakeTime - 50),
          ancillaryData,
          proposedPrice: ethers.BigNumber.from(456),
          identifier,
        },
      };

      // Stub paginatedEventQuery to return different results based on the filter type.
      const paginatedEventQueryStub = sandbox
        .stub(commonModule, "paginatedEventQuery")
        .callsFake(async (oo, filter) => {
          if (filter.topics?.[0] === oo.filters.DisputePrice(null, null, null, null, null, null, null).topics?.[0]) {
            return []; // Return an empty array for DisputePrice filter
          }
          return [fakeEventBelow as any, fakeEventAbove as any]; // Return existing data for ProposePrice filter
        });

      const params = await createMonitoringParams();
      // Set the parameter to 120 seconds.
      params.checkBeforeExpirationSeconds = 120;
      const result = await commonModule.getPolymarketProposedPriceRequestsOO(params, "v2", [fakeRequester]);

      // Expect that only the event with expirationTime fakeTime+100 (the "close-to-expiration" event) is returned.
      assert.equal(result.length, 1, "Expected one event to pass the expiration filter");
      assert.equal(
        result[0].requestHash,
        "0xeventBelow",
        "Expected the event with expiration close enough to current time to pass the filter"
      );

      dateNowStub.restore();
      paginatedEventQueryStub.restore();
    });
  });
});
