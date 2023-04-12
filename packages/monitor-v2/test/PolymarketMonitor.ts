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
import { BotModes, MonitoringParams } from "../src/monitor-polymarket/common";
import { monitorTransactionsProposedOrderBook } from "../src/monitor-polymarket/MonitorProposalsOrderBook";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { formatBytes32String, getContractFactory, hre, Provider, Signer } from "./utils";

const ethers = hre.ethers;

describe("PolymarketNotifier", function () {
  let oov2: OptimisticOracleV2Ethers;
  let deployer: Signer;
  const indentifier = formatBytes32String("TEST_IDENTIFIER");

  const mockData: any[] = [
    {
      resolvedBy: "",
      questionID: "",
      createdAt: "2023-01-30 19:06:23.106+00",
      question: "Will NATO expand by June 30?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["1", "0"],
      liquidityNum: 2499.29,
      volumeNum: 29198.55,
      clobTokenIds: [
        "41909194383884489857051533149267887932706513238474711698327450766299364965897",
        "46296129944740145134028887886488800558338482961897658822042889421944724008114",
      ],
      ancillaryData: "0x123",
      txHash: "0xffc94945ccdfced83fb9c4ea3aaecd145130f7d4065f78656b05f4afc33d6e06",
      requester: "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",
      proposer: "0xdebA18a1CD3fd1c8FE74640d3959bA03AC7DB5f3",
      timestamp: 1675106721,
      eventTimestamp: 1680615675,
      eventBlockNumber: 41135219,
      expirationTimestamp: 1680622875,
      proposalTimestamp: 1680615675,
      identifier: "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000",
      eventIndex: 366,
    },
  ];

  // Create monitoring params for single block to pass to monitor modules.
  const createMonitoringParams = async (): Promise<MonitoringParams> => {
    // Bot modes are not used as we are calling monitor modules directly.
    const botModes: BotModes = {
      transactionsProposedEnabled: true,
    };

    const binaryAdapterAddress = "dummy";
    const ctfAdapterAddress = "dummy";
    const graphqlEndpoint = "dummy";
    const apiEndpoint = "dummy";

    return {
      binaryAdapterAddress,
      ctfAdapterAddress,
      graphqlEndpoint,
      apiEndpoint,
      provider: ethers.provider as Provider,
      chainId: (await ethers.provider.getNetwork()).chainId,
      blockRange: { start: 0, end: 0 },
      pollingDelay: 0,
      botModes,
    };
  };

  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [deployer] = (await ethers.getSigners()) as Signer[];

    // Get contract instances.
    const { finder, votingToken, identifierWhitelist, collateralWhitelist } = (await umaEcosystemFixture()) as {
      votingToken: VotingTokenEthers;
      finder: FinderEthers;
      identifierWhitelist: IdentifierWhitelistEthers;
      collateralWhitelist: AddressWhitelistEthers;
    };
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

    const multicall = await (await getContractFactory("MulticallMakerDao", deployer)).deploy();

    addGlobalHardhatTestingAddress("OptimisticOracle", oo.address);
    addGlobalHardhatTestingAddress("OptimisticOracleV2", oov2.address);
    addGlobalHardhatTestingAddress("MulticallMakerDao", multicall.address);

    await (await identifierWhitelist.addSupportedIdentifier(indentifier)).wait();
    await (await collateralWhitelist.addToWhitelist(votingToken.address)).wait();

    // clear all mocks
    sinon.restore();

    const getNotifiedProposalsMock = sinon.stub();
    getNotifiedProposalsMock.returns({});
    sinon.stub(commonModule, "getNotifiedProposals").callsFake(getNotifiedProposalsMock);

    const storeNotifiedProposalsMock = sinon.stub();
    storeNotifiedProposalsMock.returns({});
    sinon.stub(commonModule, "storeNotifiedProposals").callsFake(storeNotifiedProposalsMock);
  });

  it("It should notify if there are orders over the threshold", async function () {
    mockData[0].orderBooks = [
      {
        bids: [],
        asks: [],
      },
      {
        bids: [],
        asks: [
          {
            price: 0.9,
            size: 100,
          },
        ],
      },
    ];

    const mockDataFunction = sinon.stub();
    mockDataFunction.returns(mockData);
    sinon.stub(commonModule, "getPolymarketMarkets").callsFake(mockDataFunction);
    sinon.stub(commonModule, "getMarketsAncillary").callsFake(mockDataFunction);
    sinon.stub(commonModule, "getPolymarketOrderBooks").callsFake(mockDataFunction);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // The spy should have been called as the order book is not empty.
    assert.equal(spy.callCount, 1);
    assert.equal(spy.getCall(0).lastArg.at, "PolymarketMonitor");
    assert.equal(spy.getCall(0).lastArg.message, "Difference between proposed price and market signal! 🚨");
    assert.equal(spyLogLevel(spy, 0), "warn");
    assert.isTrue(
      spyLogIncludes(spy, 0, ` Someone is trying to sell 100 winner outcome tokens at a price of 0.9 on the orderbook.`)
    ); // price
    assert.equal(spy.getCall(0).lastArg.notificationPath, "polymarket-notifier");
  });
  it("It should not notify if orders are merge or mint operations", async function () {
    mockData[0].proposedPrice = "1.0";
    mockData[0].orderBooks = [
      {
        bids: [
          {
            price: "0.5",
            size: "100",
          },
        ],
        asks: [
          {
            price: "0.5",
            size: "100",
          },
        ],
      },
      {
        bids: [
          {
            price: "0.5",
            size: "100",
          },
        ],
        asks: [
          {
            price: "0.5",
            size: "100",
          },
        ],
      },
    ];

    const mockDataFunction = sinon.stub();
    mockDataFunction.returns(mockData);
    sinon.stub(commonModule, "getPolymarketMarkets").callsFake(mockDataFunction);
    sinon.stub(commonModule, "getMarketsAncillary").callsFake(mockDataFunction);
    sinon.stub(commonModule, "getPolymarketOrderBooks").callsFake(mockDataFunction);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    assert.equal(spy.callCount, 0);
  });
  it("It should not notify if order book is empty", async function () {
    mockData[0].proposedPrice = "1.0";
    mockData[0].orderBooks = [
      {
        bids: [],
        asks: [],
      },
      {
        bids: [],
        asks: [],
      },
    ];

    const mockDataFunction = sinon.stub();
    mockDataFunction.returns(mockData);
    sinon.stub(commonModule, "getPolymarketMarkets").callsFake(mockDataFunction);
    sinon.stub(commonModule, "getMarketsAncillary").callsFake(mockDataFunction);
    sinon.stub(commonModule, "getPolymarketOrderBooks").callsFake(mockDataFunction);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposedOrderBook(spyLogger, await createMonitoringParams());

    // The spy should not have been called as the order book is empty.
    assert.equal(spy.callCount, 0);
  });
});
