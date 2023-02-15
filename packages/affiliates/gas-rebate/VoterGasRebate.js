/**
 *
 * This script calculates transaction fees spent by voters who (1) revealed votes and (2) claimed voting rewards
 * during a specified time period. The output is a JSON that displays the amount of UMA or ETH that can be used to "rebate"
 * these voters for their transaction costs incurred while voting.
 *
 * This script therefore relies on accurate (1) average gas price data over the specified period (i.e. in gwei), (2) average
 * ETH price data over the period, and (3) average UMA price data over the period. It also needs the current UMA-ETH price.
 *
 * Run: (from repo root) node ./packages/affiliates/gas-rebate/VoterGasRebate.js  --rebateNumber 4 --start-block 11112533 --end-block 11413784 --network mainnet_mnemonic
 *
 * Config options (can be specified as CLI flags):
 * - start: {Number, optional} start timestamp to query Reveal and Claim events from, described in Unix time in seconds.
 *          Defaults to default end time - 5 days.
 * - end: {Number, optional} end timestamp to query Reveal and Claim events up to, described in Unix time in seconds.
 *          Defaults to current time minus 1 day.
 * - start-block: {Number, optional} start block to query Reveal and Claim events from.
 *          Defaults to default end time - 5 days.
 * - end-block: {Number, optional} end block to query Reveal and Claim events up to.
 *          Defaults to current time minus 1 day.
 * - reveal-only: {Boolean, optional} Only query and parse Reveal events. Skip Claim events
 *          Defaults to false.
 * - claim-only: {Boolean, optional} Only query and parse Claim events. Skip Reveal events
 *          Defaults to false.
 */

require("dotenv").config();
const moment = require("moment");
const fetch = require("node-fetch");
const cliProgress = require("cli-progress");
const argv = require("minimist")(process.argv.slice(), {
  string: ["start", "end", "rebateNumber", "start-block", "end-block"],
  boolean: ["reveal-only", "claim-only"],
});
const fs = require("fs");
const path = require("path");

// Locally stored list of DesignatedVoting wallets to substitute with their hot wallets:
let addressesToReplace = [];
try {
  addressesToReplace = require("./2KEY_ADDRESS_OVERRIDE.json").map((a) => a.toLowerCase());
} catch (err) {
  // Do nothing, file doesn't exist.
}

const FindBlockAtTimestamp = require("./FindBlockAtTimeStamp");
const { getAbi, getAddress } = require("@uma/contracts-node");
const { getWeb3 } = require("@uma/common");
/** *****************************************
 *
 * SETUP
 *
 *******************************************/
const web3 = getWeb3();
const { toBN, toWei, fromWei, toChecksumAddress } = web3.utils;
const SCALING_FACTOR = toBN(toWei("1"));
const multibar = new cliProgress.MultiBar(
  {
    format: "{label} [{bar}] {percentage}% | ⏳ ETA: {eta}s | events parsed: {value}/{total}",
    hideCursor: true,
    clearOnComplete: false,
    stopOnComplete: true,
  },
  cliProgress.Presets.shades_classic
);
// Keep track of useful metrics for this current script run, such as unique identifiers seen across all claim and reveal events:
const metrics = {};
metrics["identifiers"] = [];

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
async function parseRevealEvents({ committedVotes, revealedVotes, priceData, rebateOutput, debug = false }) {
  // Any entries in `revealVotersToRebate` will result in an UMA rebate.
  const revealVotersToRebate = {};
  // Store transaction hashes so that we can prevent duplicate rebates for different Reveals within the same batch transaction.
  const batchTxns = {};

  let progressBarReveal;
  if (!debug) {
    progressBarReveal = multibar.create(revealedVotes.length, 0, { label: "Reveal Events" });
  }

  for (let i = 0; i < revealedVotes.length; i++) {
    try {
      const reveal = revealedVotes[i];

      const voter = reveal.returnValues.voter;
      const roundId = reveal.returnValues.roundId;
      const identifier = web3.utils.hexToUtf8(reveal.returnValues.identifier);
      const requestTime = reveal.returnValues.time;
      const [transactionBlock, transactionReceipt] = await Promise.all([
        web3.eth.getBlock(reveal.blockNumber),
        web3.eth.getTransactionReceipt(reveal.transactionHash),
      ]);

      // Metrics:
      const uniqueVoteKey = `${identifier}-${requestTime}`;
      if (metrics.identifiers.indexOf(uniqueVoteKey) === -1) metrics.identifiers.push(uniqueVoteKey);

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
          txnTimestamp: transactionBlock.timestamp,
        },
      };

      // Try to find associated commit with this reveal
      const latestCommitEvent = committedVotes.find((e) => {
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
          web3.eth.getTransactionReceipt(latestCommitEvent.transactionHash),
        ]);
        val.commit = {
          transactionBlock: commitBlock.number,
          hash: commitReceipt.transactionHash,
          gasUsed: parseInt(commitReceipt.gasUsed),
          txnTimestamp: commitBlock.timestamp,
        };
      } else {
        console.error(
          `Could not find VoteCommitted event matching the reveal event: ${JSON.stringify(reveal.returnValues)}`
        );
      }

      // Save and continue to lookup txn data for next event. Skip this reveal if it was already included as
      // part of a batch transaction.
      if (!batchTxns[transactionReceipt.transactionHash]) {
        batchTxns[transactionReceipt.transactionHash] = true;
        revealVotersToRebate[key] = val;
      }

      if (progressBarReveal) {
        progressBarReveal.update(i + 1);
      }
    } catch (err) {
      console.error("Failed to query data for reveal", revealedVotes[i], err);
    }
  }
  if (progressBarReveal) {
    progressBarReveal.stop();
  }

  // Rebate voters
  const rebateReceipts = {};
  let totalGasUsed = 0;
  let totalEthSpent = 0;
  let totalUmaRepaid = 0;
  let umaToPay;
  for (let voterKey of Object.keys(revealVotersToRebate)) {
    // Reveal
    const revealData = revealVotersToRebate[voterKey].reveal;
    let revealGasUsed = revealData.gasUsed;
    totalGasUsed += revealGasUsed;
    const revealGasData = getDataForTimestamp(priceData.dailyAvgGasPrices, revealData.txnTimestamp);
    let revealEthToPay = toBN(toWei(revealGasData.avgGwei, "gwei")).mul(toBN(revealGasUsed));
    let ethToPay = revealEthToPay;
    const revealUmaData = getDataForTimestamp(priceData.dailyAvgUmaEthPrices, revealData.txnTimestamp);
    let revealUmaToPay = revealEthToPay.mul(SCALING_FACTOR).div(toBN(toWei(revealUmaData.avgPx)));
    umaToPay = revealUmaToPay;

    // Commit
    const commitData = revealVotersToRebate[voterKey].commit;
    let commitGasData, commitUmaData, commitGasUsed, commitEthToPay, commitUmaToPay;
    if (commitData) {
      commitGasUsed = commitData.gasUsed;
      totalGasUsed += commitGasUsed;
      commitGasData = getDataForTimestamp(priceData.dailyAvgGasPrices, commitData.txnTimestamp);
      commitEthToPay = toBN(toWei(commitGasData.avgGwei, "gwei")).mul(toBN(commitGasUsed));
      ethToPay = ethToPay.add(commitEthToPay);
      commitUmaData = getDataForTimestamp(priceData.dailyAvgUmaEthPrices, commitData.txnTimestamp);
      commitUmaToPay = commitEthToPay.mul(SCALING_FACTOR).div(toBN(toWei(commitUmaData.avgPx)));
      umaToPay = umaToPay.add(commitUmaToPay);
    }

    const revealTxn = revealData.hash;
    const commitTxn = commitData ? commitData.hash : "N/A";

    totalEthSpent += Number(fromWei(ethToPay.toString()));
    totalUmaRepaid += Number(fromWei(umaToPay.toString()));

    rebateReceipts[voterKey] = {
      revealTimestamp: revealData.txnTimestamp,
      revealGasUsed,
      revealGasPrice: revealGasData.avgGwei,
      revealEthSpent: Number(fromWei(revealEthToPay)),
      revealUmaSpent: Number(fromWei(revealUmaToPay)),
      revealUmaEthPrice: revealUmaData.avgPx,
      revealTxn,
      commitTimestamp: commitData ? commitData.txnTimestamp : "N/A",
      commitGasUsed,
      commitGasPrice: commitGasData ? commitGasData.avgGwei : "N/A",
      commitEthSpent: commitEthToPay ? Number(fromWei(commitEthToPay)) : "N/A",
      commitUmaSpent: commitUmaToPay ? Number(fromWei(commitUmaToPay)) : "N/A",
      commitUmaEthPrice: commitUmaData ? commitUmaData.avgPx : "N/A",
      commitTxn,
      ethToPay: Number(fromWei(ethToPay)),
      umaToPay: Number(fromWei(umaToPay)),
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
    totals: { totalGasUsed: totalGasUsed, totalEthSpent: totalEthSpent, totalUmaRepaid: totalUmaRepaid },
  };
}

// The UMA dev account sometimes claims rewards on behalf of other voters, to save them gas
// speed up the reward retrieval, and ensure that no rewards expire. We want to ignore RewardsRetrieved
// events that arise from such a batch retrieval.
// Example of such a transaction: https://etherscan.io/tx/0xed907cc499fb6bdccb6fb350dd8dd9cf90e7b24c855a5e857b24156f18e0e4bb#eventlog
const UMA_DEV_ACCOUNT = "0x9a8f92a830a5cb89a3816e3d267cb7791c16b04d";

async function parseClaimEvents({ claimedRewards, priceData, rebateOutput, debug = false }) {
  // Any entries in `rewardedVotersToRebate` will result in an UMA rebate.
  const rewardedVotersToRebate = {};
  // Store transaction hashes so that we can prevent duplicate rebates for different Reveals within the same batch transaction.
  const batchTxns = {};

  let progressBarClaim;
  if (!debug) {
    progressBarClaim = multibar.create(claimedRewards.length, 0, { label: "Claim Events" });
  }

  for (let i = 0; i < claimedRewards.length; i++) {
    try {
      const claim = claimedRewards[i];
      const [transactionBlock, transactionReceipt] = await Promise.all([
        web3.eth.getBlock(claim.blockNumber),
        web3.eth.getTransactionReceipt(claim.transactionHash),
      ]);
      // Check if claim txn was sent by an UMA dev batch retrieval.
      if (toChecksumAddress(transactionReceipt.from) !== toChecksumAddress(UMA_DEV_ACCOUNT)) {
        // To prevent rebating voters who experienced someone else claiming their rewards (and thus
        // paying gas on the voter's behalf), filter out claim calls that were not instantiated
        // by the voter. Note that this might have some false negatives for edge case voters
        // who claim from different accounts.
        const voter = claim.returnValues.voter;
        if (toChecksumAddress(voter) === toChecksumAddress(transactionReceipt.from)) {
          const roundId = claim.returnValues.roundId;
          const identifier = web3.utils.hexToUtf8(claim.returnValues.identifier);
          const requestTime = claim.returnValues.time;

          // Metrics.
          const uniqueVoteKey = `${identifier}-${requestTime}`;
          if (metrics.identifiers.indexOf(uniqueVoteKey) === -1) metrics.identifiers.push(uniqueVoteKey);

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
              txnTimestamp,
            },
          };

          // Save and continue to lookup txn data for next event. Skip this claim if it was already included as
          // part of a batch transaction.
          if (!batchTxns[transactionReceipt.transactionHash]) {
            batchTxns[transactionReceipt.transactionHash] = true;
            rewardedVotersToRebate[key] = val;
          }
        }
      }

      if (progressBarClaim) {
        progressBarClaim.update(i + 1);
      }
    } catch (err) {
      console.error("Failed to query data for claim", claimedRewards[i], err);
    }
  }
  if (progressBarClaim) {
    progressBarClaim.stop();
  }

  // Rebate voters
  const rebateReceipts = {};
  let totalGasUsed = 0;
  let totalEthSpent = 0;
  let totalUmaRepaid = 0;
  for (let voterKey of Object.keys(rewardedVotersToRebate)) {
    const claimData = rewardedVotersToRebate[voterKey].claim;
    const gasUsed = claimData.gasUsed;
    const transactionDayGasData = getDataForTimestamp(priceData.dailyAvgGasPrices, claimData.txnTimestamp);
    const ethToPay = toBN(toWei(transactionDayGasData.avgGwei, "gwei")).mul(toBN(gasUsed));
    const transactionDayUmaData = getDataForTimestamp(priceData.dailyAvgUmaEthPrices, claimData.txnTimestamp);
    const umaToPay = ethToPay.mul(SCALING_FACTOR).div(toBN(toWei(transactionDayUmaData.avgPx)));
    const claimTxn = claimData.hash;

    totalGasUsed += gasUsed;
    totalEthSpent += Number(fromWei(ethToPay.toString()));
    totalUmaRepaid += Number(fromWei(umaToPay.toString()));

    rebateReceipts[voterKey] = {
      timestamp: claimData.txnTimestamp,
      gasUsed,
      gasPrice: transactionDayGasData.avgGwei,
      ethToPay: Number(fromWei(ethToPay)),
      umaEthPrice: transactionDayUmaData.avgPx,
      umaToPay: Number(fromWei(umaToPay)),
      claimTxn,
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
    totals: { totalGasUsed: totalGasUsed, totalEthSpent: totalEthSpent, totalUmaRepaid: totalUmaRepaid },
  };
}

async function calculateRebate({
  rebateNumber,
  startBlock,
  endBlock,
  revealOnly,
  claimOnly,
  dailyAvgGasPrices,
  dailyAvgUmaEthPrices,
  debug = false,
}) {
  try {
    const voting = new web3.eth.Contract(getAbi("Voting"), await getAddress("Voting", 1));
    console.log(`Using DVM @ ${voting.options.address}`);

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
      voting.getPastEvents("VoteCommitted", { fromBlock: startBlock, toBlock: endBlock }),
      voting.getPastEvents("VoteRevealed", { fromBlock: startBlock, toBlock: endBlock }),
      voting.getPastEvents("RewardsRetrieved", { fromBlock: startBlock, toBlock: endBlock }),
    ]);

    const priceData = { dailyAvgGasPrices, dailyAvgUmaEthPrices };
    const readablePriceData = { dailyAvgGasPrices, dailyAvgUmaEthPrices };
    if (!debug) {
      Object.keys(readablePriceData).forEach((k) => {
        if (typeof readablePriceData[k] !== "object") {
          console.log(`- ${k}: ${readablePriceData[k]}`);
        } else {
          console.log(`- ${k}: ${JSON.stringify(readablePriceData[k], null, 4)}`);
        }
      });
    }

    // Final UMA rebates to send
    const rebateOutput = {
      votingContractAddress: voting.options.address,
      rebate: rebateNumber,
      fromBlock: startBlock,
      toBlock: endBlock,
      shareHolderPayout: {}, // {[voter:string]: amountUmaToRebate:number}
      priceData: readablePriceData,
    };

    // Parallelize fetching of event data:
    const parsePromises = [];

    // Parse data for vote reveals to rebate.
    if (!claimOnly) {
      parsePromises.push(parseRevealEvents({ committedVotes, revealedVotes, priceData, rebateOutput, debug }));
    } else {
      parsePromises.push(null);
    }

    // Parse data for claimed rewards to rebate
    if (!revealOnly) {
      parsePromises.push(parseClaimEvents({ claimedRewards, priceData, rebateOutput, debug }));
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
    const [revealRebates, claimRebates] = await Promise.all(parsePromises);

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
      console.log(
        `🗄 ${Object.keys(revealRebates.rebateReceipts).length} Reveal Transactions successfully written to`,
        savePath
      );
      console.log("㊗️ Reveal Totals:", revealRebates.totals);
    }
    if (claimRebates && !debug) {
      const savePath = `${path.resolve(__dirname)}/debug/Claims_${rebateNumber}.json`;
      fs.writeFileSync(savePath, JSON.stringify(claimRebates.rebateReceipts, null, 4));
      console.log(
        `🗄 ${Object.keys(claimRebates.rebateReceipts).length} Claim Transactions successfully written to`,
        savePath
      );
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
      // Add useful data to output file:
      rebateOutput.countVoters = Object.keys(rebateOutput.shareHolderPayout).length;
      rebateOutput.uniqueIdentifiers = metrics.identifiers;
      rebateOutput.totalRebateAmount = Object.keys(rebateOutput.shareHolderPayout).reduce(
        (agg, curr) => agg + rebateOutput.shareHolderPayout[curr],
        0
      );

      // Replace designated voting wallets output file with hot wallets:
      for (let voterAddress of Object.keys(rebateOutput.shareHolderPayout)) {
        if (addressesToReplace.includes(voterAddress)) {
          try {
            // Get hot wallet
            const designatedVoting = new web3.eth.Contract(getAbi("DesignatedVoting"), voterAddress);
            const hotWallet = (await designatedVoting.methods.getMember(1).call()).toLowerCase();
            // Add hot wallet to output
            rebateOutput.shareHolderPayout[hotWallet] = rebateOutput.shareHolderPayout[voterAddress];
            // Remove cold wallet from output
            delete rebateOutput.shareHolderPayout[voterAddress];
            console.log(`Replaced [COLD-WALLET] ${voterAddress} with [HOT-WALLET]: ${hotWallet}`);
          } catch (err) {
            // Address is not a DesignatedVoting wallet, skip it.
            console.error(
              `${voterAddress} found in "2KEY_ADDRESS_OVERRIDE.json" but is not a DesignatedVoting wallet.`
            );
          }
        }
      }
      // Format output and save to file.
      const savePath = `${path.resolve(__dirname)}/rebates/Rebate_${rebateNumber}.json`;
      fs.writeFileSync(savePath, JSON.stringify(rebateOutput, null, 4));
      console.log("🗄  File successfully written to", savePath);
    }

    // Return debug and prod outputs for testing
    return { revealRebates, claimRebates, rebateOutput };
  } catch (err) {
    console.error("calculateRebate ERROR:", err);
    return;
  }
}

async function getUmaPriceAtTimestamp(timestamp) {
  try {
    const dateFormatted = moment.unix(timestamp).format("DD-MM-YYYY");
    const query = `https://api.coingecko.com/api/v3/coins/uma/history?date=${dateFormatted}`;

    const response = await fetch(query, {
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });

    let pricesResponse = await response.json();
    let ethExchangeRate = pricesResponse.market_data.current_price.eth;
    return ethExchangeRate;
  } catch (err) {
    console.error("Failed to fetch UMA historical price from Coingecko, falling back to default");
    return 0.0016;
  }
}

async function getHistoricalGasPrice(startBlock, endBlock) {
  const startTime = (await web3.eth.getBlock(startBlock)).timestamp;
  const startTimeString = moment.unix(startTime).format("YYYY-MM-DD");
  const endTime = (await web3.eth.getBlock(endBlock)).timestamp;
  const endTimeString = moment.unix(endTime).format("YYYY-MM-DD");

  // Construct list of days:
  const days = [];
  let counter = moment.unix(startTime);
  while (counter.isBefore(moment.unix(endTime))) {
    days.push(moment(counter));
    counter = counter.add(1, "days");
  }

  const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
  if (!etherscanApiKey) {
    console.error("Missing ETHERSCAN_API_KEY in your environment, falling back to default gas price");
    return days.map((day) => {
      return { timestamp: day.unix().toString(), avgGwei: "20" };
    });
  } else {
    const query = `https://api.etherscan.io/api?module=stats&action=dailyavggasprice&startdate=${startTimeString}&enddate=${endTimeString}&sort=asc&apikey=${etherscanApiKey}`;
    const response = await fetch(query, {
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });

    let data = (await response.json()).result;

    if (!Array.isArray(data)) throw new Error("Unexpected ETH gas price historical data format", data);

    // Return daily gas price (in Gwei) mapped to Unix timestamps so we can best estimate
    // the gas price for each transaction.
    const dailyPrices = data.map((_data) => {
      return { timestamp: Number(_data.unixTimeStamp), avgGwei: fromWei(_data.avgGasPrice_Wei, "gwei") };
    });
    return dailyPrices;
  }
}

async function getHistoricalUmaEthPrice(dailyPrices) {
  let dailyUmaPrices = [];

  // Fetch UMA-ETH exchange rates for each day
  let umaEthPricePromises = [];
  for (let day of dailyPrices) {
    umaEthPricePromises.push(getUmaPriceAtTimestamp(day.timestamp));
  }
  const umaEthPrices = await Promise.all(umaEthPricePromises);

  // Return UMA-ETH array that has same shape as daily price array
  for (let i = 0; i < dailyPrices.length; i++) {
    dailyUmaPrices.push({
      timestamp: dailyPrices[i].timestamp,
      avgPx: umaEthPrices[i].toFixed(18), // Cut off any digits beyond 18th decimal so that we we can parse
      // this `avgPx` using toWei.
    });
  }

  return dailyUmaPrices;
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
    console.log("* - Fetching UMA-ETH exchange rates     *");
    console.log("*                                       *");
    console.log("*=======================================*");

    // Make sure user is on Mainnet.
    const networkId = await web3.eth.net.getId();
    if (networkId !== 1)
      throw new Error("You are not using a Mainnet web3 provider, script will produce devastating results 🧟‍♂️");

    const rebateNumber = argv.rebateNumber ? argv.rebateNumber : "1";
    // First check if block numbers are passed in, then default to timetamps.
    let startBlock;
    let endBlock;
    if (argv["start-block"] || argv["end-block"]) {
      endBlock = argv["end-block"] ? argv["end-block"] : (await web3.eth.getBlockNumber()) - 5000; // Default: Current block minus ~1 day of blocks.
      startBlock = argv["start-block"] ? argv["start-block"] : endBlock - 25000; // Default: End time - ~5 days of blocks.
    } else {
      const endDate = argv.end ? argv.end : Math.round(Date.now() / 1000 - 24 * 60 * 60); // Default: Current time minus 1 day.
      const startDate = argv.start ? argv.start : endDate - 60 * 60 * 24 * 5; // Default: End time - 5 days
      console.log(`- Using start date: ${moment.unix(startDate).toString()}`);
      console.log(`- Using end date: ${moment.unix(endDate).toString()}`);

      endBlock = (await FindBlockAtTimestamp._findBlockNumberAtTimestamp(web3, Number(endDate), 1, 1, 1, 14))
        .blockNumber;
      startBlock = (await FindBlockAtTimestamp._findBlockNumberAtTimestamp(web3, Number(startDate), 1, 1, 1, 14))
        .blockNumber;
    }

    // Fetch gas price data in parallel
    const pricePromises = [];
    pricePromises.push(getHistoricalGasPrice(startBlock, endBlock));

    const [dailyAvgGasPrices] = await Promise.all(pricePromises);
    if (!dailyAvgGasPrices) {
      throw new Error("Missing price data");
    }
    const dailyAvgUmaEthPrices = await getHistoricalUmaEthPrice(dailyAvgGasPrices);
    console.log("- ✅ Success, running main script now");

    // Pull the parameters from process arguments. Specifying them like this lets tests add its own.
    await calculateRebate({
      rebateNumber,
      startBlock,
      endBlock,
      revealOnly: argv["reveal-only"],
      claimOnly: argv["claim-only"],
      dailyAvgGasPrices,
      dailyAvgUmaEthPrices,
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

Main.getHistoricalUmaEthPrice = getHistoricalUmaEthPrice;
Main.getHistoricalGasPrice = getHistoricalGasPrice;
Main.calculateRebate = calculateRebate;
Main.getDataForTimestamp = getDataForTimestamp;
Main.SCALING_FACTOR = SCALING_FACTOR;
module.exports = Main;
