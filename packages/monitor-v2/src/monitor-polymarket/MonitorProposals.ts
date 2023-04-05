import { OptimisticOracleEthers, OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { ProposePriceEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { paginatedEventQuery } from "../utils/EventUtils";
import {
  getContractInstanceWithProvider,
  getMarketsAncillary,
  getMarketsHistoricPrices,
  getPolymarketMarkets,
  Logger,
  MonitoringParams,
  PolymarketWithEventData,
} from "./common";
import { Networker } from "@uma/financial-templates-lib";
import { ethers } from "ethers";

const sample = [
  {
    resolvedBy: "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",
    questionID: "0x39b25776bca3de16d2e675c9008affaf553ccc60beaf8c5becd4fdbc1c9837c0",
    createdAt: "2023-03-30 18:06:51.081+00",
    question:
      "Will 'Dungeons & Dragons: Honor Among Thieves' gross more than $40 million domestically on its opening weekend?",
    outcomes: ["Yes", "No"],
    outcomePrices: ["0.02", "0.98"],
    liquidityNum: 127.25,
    volumeNum: 619,
    clobTokenIds: [
      "49390770697752999814880676885924243654140331558328818301927734806461268108309",
      "109095393444144344096382334265628849093514557417302292905105233595600407559345",
    ],
    ancillaryData:
      "0x713a207469746c653a2057696c6c202744756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573272067726f7373206d6f7265207468616e20243430206d696c6c696f6e20646f6d6573746963616c6c79206f6e20697473206f70656e696e67207765656b656e643f2c206465736372697074696f6e3a202744756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573272028323032332920697320616e207570636f6d696e6720416d65726963616e20616374696f6e2066616e746173792066696c6d2070726f647563656420627920506172616d6f756e742050696374757265732e204974206973206261736564206f6e20746865207461626c65746f7020726f6c652d706c6179696e672067616d652074686174206265617273207468652073616d65206e616d6520616e642073746172732043687269732050696e652e204974206973207363686564756c656420666f72207468656174726963616c2072656c6561736520696e2074686520555341206f6e204d617263682033312c20323032332e0a0a546869732069732061206d61726b6574206f6e20686f77206d75636820e2809844756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573272077696c6c2067726f737320646f6d6573746963616c6c79206f6e20697473206f70656e696e67207765656b656e642e2054686520e2809c446f6d6573746963205765656b656e64e2809d20746162206f6e2068747470733a2f2f7777772e626f786f66666963656d6f6a6f2e636f6d2f72656c656173652f726c313837393431303137372f2077696c6c206265207573656420746f207265736f6c76652074686973206d61726b6574206f6e6365207468652076616c75657320666f7220746865206f70656e696e67207765656b656e6420284d6172203331202d20417072203229206172652066696e616c2028692e652e206e6f742073747564696f20657374696d61746573292e0a0a54686973206d61726b65742077696c6c207265736f6c766520746f20225965732220696620e2809844756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573e280992067726f73736573206d6f7265207468616e202434302c3030302c303030206f6e20697473206f70656e696e67207765656b656e642e204f74686572776973652c2074686973206d61726b65742077696c6c207265736f6c766520746f20224e6f222e0a0a4f70656e696e67207765656b656e6420697320646566696e656420617320746865206669727374204672696461792c2053617475726461792c20616e642053756e646179206f66207468652066696c6d27732072656c656173652e20506c65617365206e6f74652c2074686973206d61726b65742077696c6c207265736f6c7665206163636f7264696e6720746f2074686520426f78204f6666696365204d6f6a6f206e756d62657220756e64657220446f6d6573746963205765656b656e6420666f722074686520332d646179207765656b656e642c207265676172646c657373206f66207768657468657220646f6d65737469632072656665727320746f206f6e6c7920746865205553412c206f7220746f2055534120616e642043616e6164612c206574632e0a0a4966207468657265206973206e6f2066696e616c206461746120617661696c61626c6520627920417072696c2031372c20323032332c2031313a35393a353920504d2045542c20616e6f74686572206372656469626c65207265736f6c7574696f6e20736f757263652077696c6c2062652063686f73656e2e207265735f646174613a2070313a20302c2070323a20312c2070333a20302e352e20576865726520703120636f72726573706f6e647320746f204e6f2c20703220746f205965732c20703320746f20756e6b6e6f776e2f35302d35302c696e697469616c697a65723a39313433306361643264333937353736363439393731376661306436366137386438313465356335",
    txHash: "0xf4ecc347aa1fdaff07702f946a241f219f6e388b445efc51419270393d1cf18f",
    requester: "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",
    proposer: "0xCfdD6663018840621FA812Ba6043acb5B1FA29D1",
    timestamp: 1680200292,
    expirationTimestamp: 1680706692,
    proposalTimestamp: 1680699492,
    identifier: "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000",
    proposedPrice: "0.0",
    historicPrices: [0.02, 0.98],
  },
  {
    resolvedBy: "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",
    questionID: "0xc8d266db884fb19fd7f8cfd3bef7a5e4a8cab20e0daaa12adaafa6b77801eef1",
    createdAt: "2023-03-30 18:06:51.08+00",
    question:
      "Will 'Dungeons & Dragons: Honor Among Thieves' gross more than $35 million domestically on its opening weekend?",
    outcomes: ["Yes", "No"],
    outcomePrices: ["0.98", "0.02"],
    liquidityNum: 60,
    volumeNum: 130,
    clobTokenIds: [
      "17500245977421908134986394661195314958680314984228884717856949481071456871590",
      "42109286025140380757085073874960491811703762360352715915794990723790367452371",
    ],
    ancillaryData:
      "0x713a207469746c653a2057696c6c202744756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573272067726f7373206d6f7265207468616e20243335206d696c6c696f6e20646f6d6573746963616c6c79206f6e20697473206f70656e696e67207765656b656e643f2c206465736372697074696f6e3a202744756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573272028323032332920697320616e207570636f6d696e6720416d65726963616e20616374696f6e2066616e746173792066696c6d2070726f647563656420627920506172616d6f756e742050696374757265732e204974206973206261736564206f6e20746865207461626c65746f7020726f6c652d706c6179696e672067616d652074686174206265617273207468652073616d65206e616d6520616e642073746172732043687269732050696e652e204974206973207363686564756c656420666f72207468656174726963616c2072656c6561736520696e2074686520555341206f6e204d617263682033312c20323032332e0a0a546869732069732061206d61726b6574206f6e20686f77206d75636820e2809844756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573272077696c6c2067726f737320646f6d6573746963616c6c79206f6e20697473206f70656e696e67207765656b656e642e2054686520e2809c446f6d6573746963205765656b656e64e2809d20746162206f6e2068747470733a2f2f7777772e626f786f66666963656d6f6a6f2e636f6d2f72656c656173652f726c313837393431303137372f2077696c6c206265207573656420746f207265736f6c76652074686973206d61726b6574206f6e6365207468652076616c75657320666f7220746865206f70656e696e67207765656b656e6420284d6172203331202d20417072203229206172652066696e616c2028692e652e206e6f742073747564696f20657374696d61746573292e0a0a54686973206d61726b65742077696c6c207265736f6c766520746f20225965732220696620e2809844756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573e280992067726f73736573206d6f7265207468616e202433352c3030302c303030206f6e20697473206f70656e696e67207765656b656e642e204f74686572776973652c2074686973206d61726b65742077696c6c207265736f6c766520746f20224e6f222e0a0a4f70656e696e67207765656b656e6420697320646566696e656420617320746865206669727374204672696461792c2053617475726461792c20616e642053756e646179206f66207468652066696c6d27732072656c656173652e20506c65617365206e6f74652c2074686973206d61726b65742077696c6c207265736f6c7665206163636f7264696e6720746f2074686520426f78204f6666696365204d6f6a6f206e756d62657220756e64657220446f6d6573746963205765656b656e6420666f722074686520332d646179207765656b656e642c207265676172646c657373206f66207768657468657220646f6d65737469632072656665727320746f206f6e6c7920746865205553412c206f7220746f2055534120616e642043616e6164612c206574632e0a0a4966207468657265206973206e6f2066696e616c206461746120617661696c61626c6520627920417072696c2031372c20323032332c2031313a35393a353920504d2045542c20616e6f74686572206372656469626c65207265736f6c7574696f6e20736f757263652077696c6c2062652063686f73656e2e207265735f646174613a2070313a20302c2070323a20312c2070333a20302e352e20576865726520703120636f72726573706f6e647320746f204e6f2c20703220746f205965732c20703320746f20756e6b6e6f776e2f35302d35302c696e697469616c697a65723a39313433306361643264333937353736363439393731376661306436366137386438313465356335",
    txHash: "0x7818bb153b24292d643188c7078ebd826917e67fb41dad3674eb8152443471ae",
    requester: "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",
    proposer: "0xCfdD6663018840621FA812Ba6043acb5B1FA29D1",
    timestamp: 1680200278,
    expirationTimestamp: 1680706814,
    proposalTimestamp: 1680699614,
    identifier: "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000",
    proposedPrice: "1.0",
    historicPrices: [0.98, 0.02],
  },
  {
    resolvedBy: "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",
    questionID: "0x0545564c83ab0eb6b3eee5cff9961a08c296eeca80fe0595801717b8681ab97f",
    createdAt: "2023-03-30 18:06:51.081+00",
    question:
      "Will 'Dungeons & Dragons: Honor Among Thieves' gross more than $45 million domestically on its opening weekend?",
    outcomes: ["Yes", "No"],
    outcomePrices: ["0.02", "0.98"],
    liquidityNum: 61.5,
    volumeNum: 115,
    clobTokenIds: [
      "87912991649919825424496221529828492229695670884697989365620542425659000234534",
      "33250363026400881432980118792803125103166000871569792127829979334528048259851",
    ],
    ancillaryData:
      "0x713a207469746c653a2057696c6c202744756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573272067726f7373206d6f7265207468616e20243435206d696c6c696f6e20646f6d6573746963616c6c79206f6e20697473206f70656e696e67207765656b656e643f2c206465736372697074696f6e3a202744756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573272028323032332920697320616e207570636f6d696e6720416d65726963616e20616374696f6e2066616e746173792066696c6d2070726f647563656420627920506172616d6f756e742050696374757265732e204974206973206261736564206f6e20746865207461626c65746f7020726f6c652d706c6179696e672067616d652074686174206265617273207468652073616d65206e616d6520616e642073746172732043687269732050696e652e204974206973207363686564756c656420666f72207468656174726963616c2072656c6561736520696e2074686520555341206f6e204d617263682033312c20323032332e0a0a546869732069732061206d61726b6574206f6e20686f77206d75636820e2809844756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573272077696c6c2067726f737320646f6d6573746963616c6c79206f6e20697473206f70656e696e67207765656b656e642e2054686520e2809c446f6d6573746963205765656b656e64e2809d20746162206f6e2068747470733a2f2f7777772e626f786f66666963656d6f6a6f2e636f6d2f72656c656173652f726c313837393431303137372f2077696c6c206265207573656420746f207265736f6c76652074686973206d61726b6574206f6e6365207468652076616c75657320666f7220746865206f70656e696e67207765656b656e6420284d6172203331202d20417072203229206172652066696e616c2028692e652e206e6f742073747564696f20657374696d61746573292e0a0a54686973206d61726b65742077696c6c207265736f6c766520746f20225965732220696620e2809844756e67656f6e73202620447261676f6e733a20486f6e6f7220416d6f6e672054686965766573e280992067726f73736573206d6f7265207468616e202434352c3030302c303030206f6e20697473206f70656e696e67207765656b656e642e204f74686572776973652c2074686973206d61726b65742077696c6c207265736f6c766520746f20224e6f222e0a0a4f70656e696e67207765656b656e6420697320646566696e656420617320746865206669727374204672696461792c2053617475726461792c20616e642053756e646179206f66207468652066696c6d27732072656c656173652e20506c65617365206e6f74652c2074686973206d61726b65742077696c6c207265736f6c7665206163636f7264696e6720746f2074686520426f78204f6666696365204d6f6a6f206e756d62657220756e64657220446f6d6573746963205765656b656e6420666f722074686520332d646179207765656b656e642c207265676172646c657373206f66207768657468657220646f6d65737469632072656665727320746f206f6e6c7920746865205553412c206f7220746f2055534120616e642043616e6164612c206574632e0a0a4966207468657265206973206e6f2066696e616c206461746120617661696c61626c6520627920417072696c2031372c20323032332c2031313a35393a353920504d2045542c20616e6f74686572206372656469626c65207265736f6c7574696f6e20736f757263652077696c6c2062652063686f73656e2e207265735f646174613a2070313a20302c2070323a20312c2070333a20302e352e20576865726520703120636f72726573706f6e647320746f204e6f2c20703220746f205965732c20703320746f20756e6b6e6f776e2f35302d35302c696e697469616c697a65723a39313433306361643264333937353736363439393731376661306436366137386438313465356335",
    txHash: "0xbd3fc92e00c5bd78b67f6369c8b1b48c102d1e3fd3060891b82255799abc9052",
    requester: "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74",
    proposer: "0xCfdD6663018840621FA812Ba6043acb5B1FA29D1",
    timestamp: 1680200306,
    expirationTimestamp: 1680706660,
    proposalTimestamp: 1680699460,
    identifier: "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000",
    proposedPrice: "0.0",
    historicPrices: [0.02, 0.98],
  },
];

export async function monitorTransactionsProposed(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const networker = new Networker(logger);
  const currentBlockNumber = await params.provider.getBlockNumber();

  // These values are hardcoded for the Polygon network as this bot is only intended to run on Polygon.
  const maxBlockLookBack = 3499; // Polygons max block look back is 3499 blocks.
  const onDayInBlocks = 43200; // 1 day in blocks on Polygon is 43200 blocks.

  const searchConfig = {
    fromBlock: currentBlockNumber - onDayInBlocks < 0 ? 0 : currentBlockNumber - onDayInBlocks,
    toBlock: currentBlockNumber,
    maxBlockLookBack,
  };

  const ooDefaultLiveness = 7200;
  const oo = await getContractInstanceWithProvider<OptimisticOracleEthers>("OptimisticOracle", params.provider);
  const oov2 = await getContractInstanceWithProvider<OptimisticOracleV2Ethers>("OptimisticOracleV2", params.provider);
  const eventsOo = await paginatedEventQuery<ProposePriceEvent>(oo, oo.filters.ProposePrice(), searchConfig);
  const eventsOov2 = await paginatedEventQuery<ProposePriceEvent>(oov2, oov2.filters.ProposePrice(), searchConfig);

  const proposalEvents = [...eventsOo, ...eventsOov2].map((event: ProposePriceEvent) => ({
    txHash: event.transactionHash,
    requester: event.args.requester,
    proposer: event.args.proposer,
    timestamp: event.args.timestamp.toNumber(),
    expirationTimestamp: event.args.expirationTimestamp.toNumber(),
    proposalTimestamp: event.args.expirationTimestamp.toNumber() - ooDefaultLiveness,
    identifier: event.args.identifier,
    ancillaryData: event.args.ancillaryData,
    proposedPrice: ethers.utils.formatEther(event.args.proposedPrice),
  }));

  const markets = await getPolymarketMarkets(params);
  const marketsWithAncillary = await getMarketsAncillary(params, markets);
  const marketsWithEventData: PolymarketWithEventData[] = marketsWithAncillary
    .filter((market) => proposalEvents.find((event) => event.ancillaryData === market.ancillaryData))
    .map((market) => {
      const event = proposalEvents.find((event) => event.ancillaryData === market.ancillaryData);
      if (!event) throw new Error("Could not find event for market");
      return {
        ...market,
        ...event,
      };
    });

  const marketsWithHistory = await getMarketsHistoricPrices(params, marketsWithEventData, networker);

  console.log(marketsWithHistory);

  for (const market of marketsWithHistory) {
    const price = market.historicPrices[0];
    const price2 = market.historicPrices[1];
    const proposedPrice = market.proposedPrice;
    const priceDiff = Math.abs(price - proposedPrice);
    const priceDiff2 = Math.abs(price2 - proposedPrice);
    if (priceDiff > 0.05 || priceDiff2 > 0.05) {
      console.log(`Price deviates from historic prices by more than 5% for ${market.marketId}`);
    }
  }
}
