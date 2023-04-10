import { addGlobalHardhatTestingAddress, ZERO_ADDRESS } from "@uma/common";
import {
  AddressWhitelistEthers,
  FinderEthers,
  IdentifierWhitelistEthers,
  OptimisticOracleV2Ethers,
  VotingTokenEthers,
} from "@uma/contracts-node";
import { BotModes, MonitoringParams, OrderBookPrice } from "../src/monitor-polymarket/common";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { formatBytes32String, getContractFactory, hre, Provider, Signer, toUtf8Bytes } from "./utils";
import sinon from "sinon";
import { createNewLogger, SpyTransport } from "@uma/financial-templates-lib";
import { monitorTransactionsProposed } from "../src/monitor-polymarket/MonitorProposals";
import * as commonModule from "../src/monitor-polymarket/common";

const ethers = hre.ethers;

describe("PolymarketNotifier", function () {
  let oov2: OptimisticOracleV2Ethers;
  let deployer: Signer;
  let disputer: Signer;
  let random: Signer;
  let proposer: Signer;
  let votingTokenAddress: string;
  const indentifier = formatBytes32String("TEST_IDENTIFIER");

  // Create monitoring params for single block to pass to monitor modules.
  const createMonitoringParams = async (): Promise<MonitoringParams> => {
    // Bot modes are not used as we are calling monitor modules directly.
    const botModes: BotModes = {
      transactionsProposedEnabled: true,
    };

    const binaryAdapterAddress = "0xCB1822859cEF82Cd2Eb4E6276C7916e692995130";
    const ctfAdapterAddress = "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74";

    const graphqlEndpoint = "https://gamma-api.polymarket.com/query";
    const apiEndpoint = "https://clob.polymarket.com";

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
    [deployer, random, proposer, disputer] = (await ethers.getSigners()) as Signer[];

    // Get contract instances.
    const { finder, votingToken, identifierWhitelist, collateralWhitelist } = (await umaEcosystemFixture()) as {
      votingToken: VotingTokenEthers;
      finder: FinderEthers;
      identifierWhitelist: IdentifierWhitelistEthers;
      collateralWhitelist: AddressWhitelistEthers;
    };
    votingTokenAddress = votingToken.address;
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

    const ctfExchange = await (await getContractFactory("CTFExchange", deployer)).deploy();

    addGlobalHardhatTestingAddress("OptimisticOracle", oo.address);
    addGlobalHardhatTestingAddress("OptimisticOracleV2", oov2.address);
    addGlobalHardhatTestingAddress("MulticallMakerDao", multicall.address);
    addGlobalHardhatTestingAddress("CTFExchange", ctfExchange.address);

    await (await identifierWhitelist.addSupportedIdentifier(indentifier)).wait();
    await (await collateralWhitelist.addToWhitelist(votingToken.address)).wait();

    const getNotifiedProposalsMock = sinon.stub();
    getNotifiedProposalsMock.returns({});
    sinon.stub(commonModule, "getNotifiedProposals").callsFake(getNotifiedProposalsMock);

    const storeNotifiedProposalsMock = sinon.stub();
    storeNotifiedProposalsMock.returns({});
    sinon.stub(commonModule, "storeNotifiedProposals").callsFake(storeNotifiedProposalsMock);
  });
  xit("Monitor transactions proposed", async function () {
    const time = 123;
    const ancillaryData = toUtf8Bytes("Test");
    await (await oov2.requestPrice(indentifier, time, ancillaryData, votingTokenAddress, 0)).wait();
    await (await oov2.proposePrice(await deployer.getAddress(), indentifier, time, ancillaryData, 1)).wait();

    // get ProposePrice event
    const events = await oov2.queryFilter(oov2.filters.ProposePrice());
    const event = events[0];

    const sample = require("./mock/polymarketContracts.json");
    const markets = sample.slice(0, 5);
    const getPolymarketMarketsMock = sinon.stub();
    getPolymarketMarketsMock.returns(markets);
    sinon.stub(commonModule, "getPolymarketMarkets").callsFake(getPolymarketMarketsMock);

    const getMarketsHistoricPricesMock = sinon.stub();
    const marketsWithHistoricPrices = markets.map((market) => {
      return {
        ...market,
        historicPrices: [[{ p: 1, t: 123 }], [{ p: 1, t: 123 }]],
        historicOrderBookSignals: [1, 1],
        historicOrderBookSignalsEfficiency: [1, 1],
      } as OrderBookPrice;
    });
    getMarketsHistoricPricesMock.returns(marketsWithHistoricPrices);
    sinon.stub(commonModule, "getMarketsHistoricPrices").callsFake(getMarketsHistoricPricesMock);

    const getOrderFilledEventsMock = sinon.stub();
    const marketsWithFilledEvents = marketsWithHistoricPrices.map((market) => {
      return {
        ...market,
        orderFilledEvents: [],
        tradeSignals: [1, 1],
        tradeSignalsEfficiency: [1, 1],
      } as OrderBookPrice;
    });
    getOrderFilledEventsMock.returns(marketsWithFilledEvents);
    sinon.stub(commonModule, "getOrderFilledEvents").callsFake(getOrderFilledEventsMock);

    const marketsWithAncillary = markets.map((market) => {
      return {
        ...market,
        ancillaryData: "0x",
      };
    });
    marketsWithAncillary[0].ancillaryData = event.args.ancillaryData;

    const getMarketsAncillaryMock = sinon.stub();
    getMarketsAncillaryMock.returns(marketsWithAncillary);
    sinon.stub(commonModule, "getMarketsAncillary").callsFake(getMarketsAncillaryMock);

    // Call monitorAssertions directly for the block when the assertion was made.
    const spy = sinon.spy();
    const spyLogger = createNewLogger([new SpyTransport({}, { spy: spy })]);
    await monitorTransactionsProposed(spyLogger, await createMonitoringParams());
  });
});
