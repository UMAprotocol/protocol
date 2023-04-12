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
      resolvedBy: "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",
      questionID: "0x7e66ff675c84e2b767a0659583068908fbeddff9565641bc3de8a5650895c528",
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
      ancillaryData:
        "0x713a207469746c653a2057696c6c204e41544f20657870616e64206279204a756e652033303f2c206465736372697074696f6e3a20546869732069732061206d61726b6574206f6e207768657468657220746865204e6f7274682041746c616e74696320547265617479204f7267616e697a6174696f6e20284e41544f292077696c6c2068617665206d6f7265207468616e2033302066756c6c206d656d6265722073746174657320666f7220616e79206c656e677468206f662074696d65206265666f7265204a756e652033302c20323032332c2031313a35393a353920504d2045542e200a0a4966204e41544f20686173206d6f7265207468616e203330206d656d6265722073746174657320617420616e7920706f696e74206279204a756e652033302c20323032332c2031313a35393a353920504d2045542074686973206d61726b65742077696c6c207265736f6c766520617320e2809c596573e2809d2e204f74686572776973652c2074686973206d61726b65742077696c6c207265736f6c766520746f20224e6f2e220a0a546865207072696d61727920736574746c656d656e7420736f7572636520666f722074686973206d61726b65742077696c6c20626520746865206f6666696369616c204e41544f2077656273697465202868747470733a2f2f7777772e6e61746f2e696e742f6370732f656e2f6e61746f68712f6e61746f5f636f756e74726965732e68746d292c20686f7765766572206f74686572206372656469626c6520736f7572636573206d617920626520757365642e207265735f646174613a2070313a20302c2070323a20312c2070333a20302e352e20576865726520703120636f72726573706f6e647320746f204e6f2c20703220746f205965732c20703320746f20756e6b6e6f776e2f35302d35302c696e697469616c697a65723a39313433306361643264333937353736363439393731376661306436366137386438313465356335",
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
