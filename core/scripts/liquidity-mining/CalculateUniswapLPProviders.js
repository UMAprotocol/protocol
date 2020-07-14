const Uniswap = artifacts.require("Uniswap");
const moment = require("moment");
const BlockNumberFinder = require("./BlockNumberFinder");

const argv = require("minimist")(process.argv.slice(), {
  string: ["uniswapMarket", "fromDate", "toDate"],
  boolean: ["test"]
});

async function CalculateUniswapLPProviders(callback) {
  try {
    if (argv.help) {
      `This utility generates a CSV to record Uniswap liquidity provider over a given window. \n
       Output includes addresses, time weighted average liquidity provision and their proportional share of liquidity provision.\n
       Run by executing: truffle exec ./scripts/liquidity-mining/CalculateUniswapLPProviders.js --network mainnet_mnemonic --uniswapMarket="0x88D97d199b9ED37C29D846d00D443De980832a22" --fromDate="2020-07-06" --toDate="2020-07-13"`;
    }
    if (!argv.uniswapMarket || !argv.fromDate || !argv.toDate) {
      throw "Missing parameter! Provide `uniswapMarket`, `fromDate` & `toDate`";
    }

    // Create two moment objects from the input string. Convert to UTC time zone. As no time is provided in the input
    // will parse to 12:00am UTC
    const fromDate = moment.utc(argv.fromDate, "YYYY-MM-DD");
    const toDate = moment.utc(argv.toDate, "YYYY-MM-DD");
    if (!fromDate.isValid() || !toDate.isValid()) {
      throw "Date objects incorrectly formatted! `fromDate` and `toDate` must be strings formatted YYYY-MM-DD";
    }
    console.log("🔥Starting Uniswap liquidity provider calculator script🔥");
    // Get the closet block numbers on each side of the from and to date, within an error band of 30 seconds (~2 blocks).
    const fromBlockNumber = await BlockNumberFinder(web3, fromDate.unix(), fromDate.unix() - 30, fromDate.unix() + 30);
    const toBlockNumber = await BlockNumberFinder(web3, toDate.unix(), toDate.unix() - 30, toDate.unix() + 30);
    console.table({
      "Search from": {
        Date: fromDate.format("dddd, MMMM Do YYYY, h:mm:ss a"),
        "Unix timestamp": fromDate.unix(),
        "Block number": fromBlockNumber
      },
      "Search until": {
        Date: toDate.format("dddd, MMMM Do YYYY, h:mm:ss a"),
        "unix timestamp": toDate.unix(),
        "block number": toBlockNumber
      }
    });

    // Create Uniswap instance at arg address.
    const uniswap = await Uniswap.at(argv.uniswapMarket);

    // Get mint and burn events from fromBlock to endBlock.
    const mintEvents = await uniswap.getPastEvents("Mint", { fromBlock: fromBlockNumber, toBlock: toBlockNumber });
    const burnEvents = await uniswap.getPastEvents("Burn", { fromBlock: fromBlockNumber, toBlock: toBlockNumber });

    console.log("MINT", mintEvents);

    console.log("BURN", burnEvents);
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
}

module.exports = CalculateUniswapLPProviders;
