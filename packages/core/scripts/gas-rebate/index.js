/**
 *
 * This script calculates transaction fees spent by voters who (1) revealed votes and (2) claimed voting rewards
 * during a specified time period. The output is a JSON that displays the amount of UMA or ETH that can be used to "rebate"
 * these voters for their transaction costs incurred while voting.
 *
 * This script therefore relies on accurate (1) average gas price data over the specified period (i.e. in gwei), (2) average
 * ETH price data over the period, and (3) average UMA price data over the period. It also needs the current UMA-ETH price.
 *
 * Run: (from repo root) `node ./packages/core/scripts/gas-rebate/index.js  --start 1598572800 --end 1599055419`
 *
 * Config options (can be specified as CLI flags):
 * - start: {Number, optional} start timestamp to query Reveal and Claim events from, described in Unix time in seconds.
 *          Defaults to default end time - 3 days.
 * - end: {Number, optional} end timestamp to query Reveal and Claim events up to, described in Unix time in seconds.
 *          Defaults to current time minus 5 minutes in case node has not processed a block at current time.
 * - reveal-only: {Boolean, optional} Only query and parse Reveal events. Skip Claim events
 *          Defaults to false.
 * - claim-only: {Boolean, optional} Only query and parse Claim events. Skip Reveal events
 *          Defaults to false.
 *
 */

require("dotenv").config();
const moment = require("moment");
const fetch = require("node-fetch");
const cliProgress = require("cli-progress");
const argv = require("minimist")(process.argv.slice(), {
  string: ["start", "end"],
  boolean: ["reveal-only", "claim-only"]
});
const fs = require("fs");
const path = require("path");
const Web3 = require("web3");
const FindBlockAtTimestamp = require("../liquidity-mining/FindBlockAtTimeStamp");
const { getAbi, getAddress } = require("@uma/core");

/** *****************************************
 *
 * SETUP
 *
 *******************************************/
const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));
const { toBN, toWei, fromWei, BN } = web3.utils;
const SCALING_FACTOR = toBN(toWei("1"));
const multibar = new cliProgress.MultiBar(
  {
    format: "{label} [{bar}] {percentage}% | ⏳ ETA: {eta}s | events parsed: {value}/{total}",
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: true
  },
  cliProgress.Presets.shades_classic
);

/** *****************************************
 *
 * HELPER MODULES
 *
 *******************************************/
// Return the day that the timestamp falls into. Used to pull the daily average
// gas/ETH price for a specific timestamp from an array of historical data from Etherscan Pro API.
function getDataForTimestamp(dayData, timestamp) {
  const sortedDayData = dayData.sort((a, b) => a.timestamp - b.timestamp);

  // If timestamp is before any of the days, return the earliest day.
  if (timestamp < sortedDayData[0].timestamp) return sortedDayData[0];

  for (let i = 0; i < sortedDayData.length - 1; i++) {
    if (timestamp >= sortedDayData[i].timestamp && timestamp < sortedDayData[i + 1].timestamp) {
      return sortedDayData[i];
    }
  }

  // If we get here, then we will just use last day.
  return sortedDayData[sortedDayData.length - 1];
}
async function parseRevealEvents({ committedVotes, revealedVotes, priceData, rebateOutput }) {
  const revealVotersToRebate = {};

  const progressBarReveal = multibar.create(revealedVotes.length, 0, { label: "Reveal Events" });

  for (let i = 0; i < revealedVotes.length; i++) {
    const reveal = revealedVotes[i];

    const voter = reveal.returnValues.voter;
    const roundId = reveal.returnValues.roundId;
    const identifier = web3.utils.hexToUtf8(reveal.returnValues.identifier);
    const requestTime = reveal.returnValues.time;
    const [transactionBlock, transactionReceipt] = await Promise.all([
      web3.eth.getBlock(reveal.blockNumber),
      web3.eth.getTransactionReceipt(reveal.transactionHash)
    ]);

    const key = `${voter}-${roundId}-${identifier}-${requestTime}`;
    const val = {
      voter,
      roundId,
      identifier,
      requestTime,
      reveal: {
        transactionBlock: transactionBlock.number,
        hash: transactionReceipt.transactionHash,
        gasUsed: parseInt(transactionReceipt.gasUsed),
        txnTimestamp: transactionBlock.timestamp
      }
    };

    // Try to find associated commit with this reveal
    const latestCommitEvent = committedVotes.find(e => {
      return (
        e.returnValues.voter === voter &&
        e.returnValues.roundId === roundId &&
        e.returnValues.identifier === reveal.returnValues.identifier &&
        e.returnValues.time === requestTime
      );
    });
    if (latestCommitEvent) {
      const [commitBlock, commitReceipt] = await Promise.all([
        web3.eth.getBlock(latestCommitEvent.blockNumber),
        web3.eth.getTransactionReceipt(latestCommitEvent.transactionHash)
      ]);
      val.commit = {
        transactionBlock: commitBlock.number,
        hash: commitReceipt.transactionHash,
        gasUsed: parseInt(commitReceipt.gasUsed),
        txnTimestamp: commitBlock.timestamp
      };
    } else {
      console.error(
        `Could not find VoteCommitted event matching the reveal event: ${JSON.stringify(reveal.returnValues)}`
      );
    }

    // Save and continue to lookup txn data for next event.
    revealVotersToRebate[key] = val;
    progressBarReveal.update(i + 1);
  }
  progressBarReveal.stop();

  // Rebate voters
  const rebateReceipts = {};
  let totalGasUsed = 0;
  let totalEthSpent = 0;
  let totalUmaRepaid = 0;
  for (let voterKey of Object.keys(revealVotersToRebate)) {
    // Reveal
    const revealData = revealVotersToRebate[voterKey].reveal;
    let revealGasUsed = revealData.gasUsed;
    totalGasUsed += revealGasUsed;
    const revealGasData = getDataForTimestamp(priceData.dailyAvgGasPrices, revealData.txnTimestamp);
    const revealEthData = getDataForTimestamp(priceData.dailyAvgEthPrices, revealData.txnTimestamp);
    let ethToPay = toBN(toWei(revealGasData.avgGwei, "gwei")).mul(toBN(revealGasUsed));
    let ethToUma = toBN(toWei(revealEthData.avgPx))
      .mul(SCALING_FACTOR)
      .div(priceData.currentUmaPrice);

    // Commit
    const commitData = revealVotersToRebate[voterKey].commit;
    let commitGasData, commitEthData, commitGasUsed;
    if (commitData) {
      commitGasUsed = commitData.gasUsed;
      totalGasUsed += commitGasUsed;
      commitGasData = getDataForTimestamp(priceData.dailyAvgGasPrices, commitData.txnTimestamp);
      commitEthData = getDataForTimestamp(priceData.dailyAvgEthPrices, commitData.txnTimestamp);
      ethToPay = ethToPay.add(toBN(toWei(commitGasData.avgGwei, "gwei")).mul(toBN(commitGasUsed)));
      ethToUma = ethToUma.add(
        toBN(toWei(commitEthData.avgPx))
          .mul(SCALING_FACTOR)
          .div(priceData.currentUmaPrice)
      );
    }

    const umaToPay = ethToPay.mul(ethToUma).div(SCALING_FACTOR);
    const revealTxn = revealData.hash;
    const commitTxn = commitData ? commitData.hash : "N/A";

    totalEthSpent += Number(fromWei(ethToPay.toString()));
    totalUmaRepaid += Number(fromWei(umaToPay.toString()));

    rebateReceipts[voterKey] = {
      revealTimestamp: revealData.txnTimestamp,
      revealGasUsed,
      revealGasPrice: revealGasData.avgGwei,
      revealEthPrice: revealEthData.avgPx,
      revealTxn,
      commitTimestamp: commitData ? commitData.txnTimestamp : "N/A",
      commitGasUsed,
      commitGasPrice: commitGasData ? commitGasData.avgGwei : "N/A",
      commitEthPrice: commitEthData ? commitEthData.avgPx : "N/A",
      commitTxn,
      ethToPay: Number(fromWei(ethToPay)),
      umaToPay: Number(fromWei(umaToPay))
    };

    const voter = revealVotersToRebate[voterKey].voter;
    if (rebateOutput.shareHolderPayout[voter.toLowerCase()]) {
      rebateOutput.shareHolderPayout[voter.toLowerCase()] += Number(fromWei(umaToPay.toString()));
    } else {
      rebateOutput.shareHolderPayout[voter.toLowerCase()] = Number(fromWei(umaToPay.toString()));
    }
  }

  return {
    rebateReceipts,
    totals: {
      totalGasUsed: totalGasUsed,
      totalEthSpent: totalEthSpent,
      totalUmaRepaid: totalUmaRepaid
    }
  };
}

async function parseClaimEvents({ claimedRewards, priceData, rebateOutput }) {
  const rewardedVotersToRebate = {};

  const progressBarClaim = multibar.create(claimedRewards.length, 0, { label: "Claim Events" });

  for (i = 0; i < claimedRewards.length; i++) {
    const claim = claimedRewards[i];
    const voter = claim.returnValues.voter;
    const roundId = claim.returnValues.roundId;
    const identifier = web3.utils.hexToUtf8(claim.returnValues.identifier);
    const requestTime = claim.returnValues.time;
    const [transactionBlock, transactionReceipt] = await Promise.all([
      web3.eth.getBlock(claim.blockNumber),
      web3.eth.getTransactionReceipt(claim.transactionHash)
    ]);
    const gasUsed = parseInt(transactionReceipt.gasUsed);
    const txnTimestamp = transactionBlock.timestamp;

    const key = `${voter}-${roundId}-${identifier}-${requestTime}`;
    const val = {
      voter,
      roundId,
      requestTime,
      identifier,
      claim: {
        transactionBlock: transactionBlock.number,
        hash: transactionReceipt.transactionHash,
        gasUsed,
        txnTimestamp
      }
    };

    rewardedVotersToRebate[key] = val;
    progressBarClaim.update(i + 1);
  }
  progressBarClaim.stop();

  // Rebate voters
  const rebateReceipts = {};
  let totalGasUsed = 0;
  let totalEthSpent = 0;
  let totalUmaRepaid = 0;
  for (let voterKey of Object.keys(rewardedVotersToRebate)) {
    const claimData = rewardedVotersToRebate[voterKey].claim;
    const gasUsed = claimData.gasUsed;
    const transactionDayGasData = getDataForTimestamp(priceData.dailyAvgGasPrices, claimData.txnTimestamp);
    const transactionDayEthData = getDataForTimestamp(priceData.dailyAvgEthPrices, claimData.txnTimestamp);
    const ethToPay = toBN(toWei(transactionDayGasData.avgGwei, "gwei")).mul(toBN(gasUsed));
    const ethToUma = toBN(toWei(transactionDayEthData.avgPx))
      .mul(SCALING_FACTOR)
      .div(priceData.currentUmaPrice);
    const umaToPay = ethToPay.mul(ethToUma).div(SCALING_FACTOR);
    const claimTxn = claimData.hash;

    totalGasUsed += gasUsed;
    totalEthSpent += Number(fromWei(ethToPay.toString()));
    totalUmaRepaid += Number(fromWei(umaToPay.toString()));

    rebateReceipts[voterKey] = {
      timestamp: claimData.txnTimestamp,
      gasUsed,
      gasPrice: transactionDayGasData.avgGwei,
      ethToPay: Number(fromWei(ethToPay)),
      umaToPay: Number(fromWei(umaToPay)),
      claimTxn
    };

    const voter = rewardedVotersToRebate[voterKey].voter;
    if (rebateOutput.shareHolderPayout[voter.toLowerCase()]) {
      rebateOutput.shareHolderPayout[voter.toLowerCase()] += Number(fromWei(umaToPay.toString()));
    } else {
      rebateOutput.shareHolderPayout[voter.toLowerCase()] = Number(fromWei(umaToPay.toString()));
    }
  }

  return {
    rebateReceipts,
    totals: {
      totalGasUsed: totalGasUsed,
      totalEthSpent: totalEthSpent,
      totalUmaRepaid: totalUmaRepaid
    }
  };
}

async function calculateRebate({
  rebateNumber,
  startBlock,
  endBlock,
  revealOnly,
  claimOnly,
  dailyAvgGasPrices,
  dailyAvgEthPrices,
  currentUmaPrice,
  debug = false
}) {
  try {
    const voting = new web3.eth.Contract(getAbi("Voting"), getAddress("Voting", 1));

    if (!debug) {
      console.log("\n\n*=======================================*");
      console.log("*                                       *");
      console.log("* 🐲⛽️ UMA Gas Rebater 🐲 ⛽️            *");
      console.log("*                                       *");
      console.log("*=======================================*");
      console.log(`- Calculating gas rebates from block ${startBlock} until ${endBlock}`);
    }

    // Query past contract events.
    const [committedVotes, revealedVotes, claimedRewards] = await Promise.all([
      voting.getPastEvents("VoteCommitted", {
        fromBlock: startBlock,
        toBlock: endBlock
      }),
      voting.getPastEvents("VoteRevealed", {
        fromBlock: startBlock,
        toBlock: endBlock
      }),
      voting.getPastEvents("RewardsRetrieved", {
        fromBlock: startBlock,
        toBlock: endBlock
      })
    ]);

    const priceData = {
      dailyAvgGasPrices,
      dailyAvgEthPrices,
      currentUmaPrice
    };
    const readablePriceData = {
      dailyAvgGasPrices,
      dailyAvgEthPrices,
      currentUmaPrice: fromWei(currentUmaPrice)
    };
    if (!debug) {
      Object.keys(readablePriceData).forEach(k => {
        if (typeof readablePriceData[k] !== "object") {
          console.log(`- ${k}: ${readablePriceData[k]}`);
        } else {
          console.log(`- ${k}: ${JSON.stringify(readablePriceData[k], null, 4)}`);
        }
      });
    }

    // Final UMA rebates to send
    const rebateOutput = {
      rebate: rebateNumber,
      fromBlock: startBlock,
      toBlock: endBlock,
      priceData: readablePriceData,
      shareHolderPayout: {} // {[voter:string]: amountUmaToRebate:number}
    };

    // Parallelize fetching of event data:
    const parsePromises = [];

    // Parse data for vote reveals to rebate.
    if (!claimOnly) {
      parsePromises.push(
        parseRevealEvents({
          committedVotes,
          revealedVotes,
          priceData,
          rebateOutput
        })
      );
    } else {
      parsePromises.push(null);
    }

    // Parse data for claimed rewards to rebate
    if (!revealOnly) {
      parsePromises.push(
        parseClaimEvents({
          claimedRewards,
          priceData,
          rebateOutput
        })
      );
    } else {
      parsePromises.push(null);
    }

    if (!debug) {
      console.log("\n\n*=======================================*");
      console.log("*                                       *");
      console.log("* 🌏 Fetching Blockchain Data 🌎        *");
      console.log("*                                       *");
      console.log("*=======================================*");
    }
    [revealRebates, claimRebates] = await Promise.all(parsePromises);

    if (!debug) {
      console.log("\n\n*=======================================*");
      console.log("*                                       *");
      console.log("* ✅ Results                           *");
      console.log("*                                       *");
      console.log("*=======================================*");
    }
    if (revealRebates && !debug) {
      const savePath = `${path.resolve(__dirname)}/debug/Reveals_${rebateNumber}.json`;
      fs.writeFileSync(savePath, JSON.stringify(revealRebates.rebateReceipts, null, 4));
      console.log("🗄  Reveal Transactions successfully written to", savePath);
      console.log("㊗️ Reveal Totals:", revealRebates.totals);
    }
    if (claimRebates && !debug) {
      const savePath = `${path.resolve(__dirname)}/debug/Claims_${rebateNumber}.json`;
      fs.writeFileSync(savePath, JSON.stringify(claimRebates.rebateReceipts, null, 4));
      console.log("🗄  Claim Transactions successfully written to", savePath);
      console.log("㊗️ Claim Totals:", claimRebates.totals);
    }
    // Output JSON parseable via disperse.app
    let totalUMAToRebate = 0;
    for (let voter of Object.keys(rebateOutput.shareHolderPayout)) {
      totalUMAToRebate += rebateOutput.shareHolderPayout[voter];
    }

    if (!debug) {
      console.log("\n\n*=======================================*");
      console.log("*                                       *");
      console.log("* 🧮 Final UMA Rebate                   *");
      console.log("*                                       *");
      console.log("*=======================================*");
      console.log(
        `🎟 UMA to rebate: ${totalUMAToRebate} across ${Object.keys(rebateOutput.shareHolderPayout).length} voters`
      );
      // Format output and save to file.
      const savePath = `${path.resolve(__dirname)}/rebates/Rebate_${rebateNumber}.json`;
      fs.writeFileSync(savePath, JSON.stringify(rebateOutput, null, 4));
      console.log("🗄  File successfully written to", savePath);
    }

    // Return debug and prod outputs for testing
    return {
      revealRebates,
      claimRebates,
      rebateOutput
    };
  } catch (err) {
    console.error("calculateRebate ERROR:", err);
    return;
  }
}

async function getUmaPrice() {
  try {
    const query = "https://api.coingecko.com/api/v3/simple/price?ids=uma&vs_currencies=usd";

    const response = await fetch(query, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });

    let priceResponse = await response.json();
    return toBN(toWei(priceResponse.uma.usd.toString(), "ether"));
  } catch (err) {
    console.error("Failed to fetch UMA price from Coingecko, falling back to default");
    return toBN(toWei("10", "ether"));
  }
}

async function getHistoricalGasPrice(startBlock, endBlock) {
  const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
  if (!etherscanApiKey) {
    console.error("Missing ETHERSCAN_API_KEY in your environment, falling back to default gas price");
    return [
      {
        timestamp: 0, // By setting timestamp to 0, this price will apply to all transactions
        avgGwei: "100"
      }
    ];
  } else {
    const startTime = (await web3.eth.getBlock(startBlock)).timestamp;
    const startTimeString = moment.unix(startTime).format("YYYY-MM-DD");
    const endTime = (await web3.eth.getBlock(endBlock)).timestamp;
    const endTimeString = moment.unix(endTime).format("YYYY-MM-DD");

    const query = `https://api.etherscan.io/api?module=stats&action=dailyavggasprice&startdate=${startTimeString}&enddate=${endTimeString}&sort=asc&apikey=${etherscanApiKey}`;
    const response = await fetch(query, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });

    let data = (await response.json()).result;

    // Return daily gas price (in Gwei) mapped to Unix timestamps so we can best estimate
    // the gas price for each transaction.
    const dailyPrices = data.map(_data => {
      return { timestamp: Number(_data.unixTimeStamp), avgGwei: fromWei(_data.avgGasPrice_Wei, "gwei") };
    });
    return dailyPrices;
  }
}

async function getHistoricalEthPrice(startBlock, endBlock) {
  const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
  if (!etherscanApiKey) {
    console.error("Missing ETHERSCAN_API_KEY in your environment, falling back to default ETH price");
    return [
      {
        timestamp: 0, // By setting timestamp to 0, this price will apply to all transactions
        avgPx: "350"
      }
    ];
  } else {
    const startTime = (await web3.eth.getBlock(startBlock)).timestamp;
    const startTimeString = moment.unix(startTime).format("YYYY-MM-DD");
    const endTime = (await web3.eth.getBlock(endBlock)).timestamp;
    const endTimeString = moment.unix(endTime).format("YYYY-MM-DD");

    const query = `https://api.etherscan.io/api?module=stats&action=ethdailyprice&startdate=${startTimeString}&enddate=${endTimeString}&sort=asc&apikey=${etherscanApiKey}`;
    const response = await fetch(query, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });

    let data = (await response.json()).result;

    // Return daily eth price mapped to Unix timestamps so we can best estimate
    // the eth price for each transaction.
    const dailyPrices = data.map(_data => {
      return { timestamp: Number(_data.unixTimeStamp), avgPx: _data.value };
    });
    return dailyPrices;
  }
}

/** *****************************************
 *
 * MAIN MODULES
 *
 *******************************************/
// Implement async callback to enable the script to be run by truffle or node.
async function Main(callback) {
  try {
    console.log("\n\n*=======================================*");
    console.log("*                                       *");
    console.log("* 🐣 Setup 🐣                           *");
    console.log("* - Fetching block number for timestamp *");
    console.log("* - Fetching historical gas px data     *");
    console.log("*                                       *");
    console.log("*=======================================*");

    const rebateNumber = 1;
    const endDate = argv.end ? argv.end : Math.round(Date.now() / 1000 - 24 * 60 * 60); // Default: Current time minus 1 day.
    const startDate = argv.start ? argv.start : endDate - 60 * 60 * 24 * 5; // Default: End time - 5 days
    console.log(`- Using start date: ${moment.unix(startDate).toString()}`);
    console.log(`- Using end date: ${moment.unix(endDate).toString()}`);
    let endBlock, startBlock;
    try {
      endBlock = (await FindBlockAtTimestamp._findBlockNumberAtTimestamp(web3, Number(endDate))).blockNumber;
      startBlock = (await FindBlockAtTimestamp._findBlockNumberAtTimestamp(web3, Number(startDate))).blockNumber;
    } catch (err) {
      throw err;
    }

    // Fetch gas price data in parallel
    const pricePromises = [];
    pricePromises.push(getHistoricalGasPrice(startBlock, endBlock));
    pricePromises.push(getHistoricalEthPrice(startBlock, endBlock));
    pricePromises.push(getUmaPrice());

    const [dailyAvgGasPrices, dailyAvgEthPrices, currentUmaPrice] = await Promise.all(pricePromises);
    if (!dailyAvgGasPrices || !dailyAvgEthPrices || !currentUmaPrice) {
      throw new Error("Missing price data");
    }
    console.log("- ✅ Success, running main script now");

    // Pull the parameters from process arguments. Specifying them like this lets tests add its own.
    await calculateRebate({
      rebateNumber,
      startBlock,
      endBlock,
      revealOnly: argv["reveal-only"],
      claimOnly: argv["claim-only"],
      dailyAvgGasPrices,
      dailyAvgEthPrices,
      currentUmaPrice
    });
  } catch (error) {
    console.error(error);
  }
  callback();
}

// If called directly by node:
function nodeCallback(err) {
  if (err) {
    console.error(err);
    process.exit(1);
  } else process.exit(0);
}

// If called directly by node, execute the core function. This lets the script be run as a node process.
if (require.main === module) {
  Main(nodeCallback)
    .then(() => {})
    .catch(nodeCallback);
}

Main.getHistoricalEthPrice = getHistoricalEthPrice;
Main.getHistoricalGasPrice = getHistoricalGasPrice;
Main.getUmaPrice = getUmaPrice;
Main.calculateRebate = calculateRebate;
Main.getDataForTimestamp = getDataForTimestamp;
Main.SCALING_FACTOR = SCALING_FACTOR;
module.exports = Main;
