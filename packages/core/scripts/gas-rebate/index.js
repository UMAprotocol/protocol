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
const fetch = require("node-fetch");
const cliProgress = require("cli-progress");
const argv = require("minimist")(process.argv.slice(), {
  string: ["start", "end"],
  boolean: ["reveal-only", "claim-only"]
});
const fs = require("fs");
const path = require("path");
const Web3 = require("web3");
const VotingAbi = require("../../build/contracts/Voting.json");
const FindBlockAtTimestamp = require("../liquidity-mining/FindBlockAtTimeStamp");

const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));
const { toBN, toWei, fromWei } = web3.utils;

async function parseRevealEvents(committedVotes, revealedVotes, priceData, multibar, rebateOutput) {
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
    const gasUsed = parseInt(transactionReceipt.gasUsed);

    // Find associated commit with this reveal
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
      const commitGasUsed = parseInt(commitReceipt.gasUsed, 16);

      const key = `${voter}-${roundId}-${identifier}-${requestTime}`;
      const val = {
        voter,
        roundId,
        identifier,
        requestTime,
        reveal: {
          transactionBlock: transactionBlock.number,
          hash: transactionReceipt.transactionHash,
          gasUsed
        },
        commit: {
          transactionBlock: commitBlock.number,
          hash: commitReceipt.transactionHash,
          gasUsed: commitGasUsed
        }
      };

      revealVotersToRebate[key] = val;
      progressBarReveal.update(i + 1);
    } else {
      throw new Error(
        `Could not find VoteCommitted event matching the reveal event: ${JSON.stringify(reveal.returnValues)}`
      );
    }
  }
  progressBarReveal.stop();

  // Rebate voters
  const rebateReceipts = {};
  let totalGasUsed = 0;
  let totalEthSpent = 0;
  let totalUmaRepaid = 0;
  for (let voterKey of Object.keys(revealVotersToRebate)) {
    const revealData = revealVotersToRebate[voterKey].reveal;
    const commitData = revealVotersToRebate[voterKey].reveal;
    const gasUsed = revealData.gasUsed + commitData.gasUsed;
    const ethToPay = toBN(priceData.averagePriceGweiForPeriod).mul(toBN(gasUsed));
    const umaToPay = ethToPay.mul(priceData.ethToUma).div(priceData.SCALING_FACTOR);
    const commitTxn = commitData.hash;
    const revealTxn = revealData.hash;

    totalGasUsed += gasUsed;
    totalEthSpent += Number(fromWei(ethToPay.toString()));
    totalUmaRepaid += Number(fromWei(umaToPay.toString()));

    rebateReceipts[voterKey] = {
      gasUsed,
      ethToPay: Number(fromWei(ethToPay)),
      umaToPay: Number(fromWei(umaToPay)),
      commitTxn,
      revealTxn
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
      totalGasUsed: totalGasUsed.toLocaleString(),
      totalEthSpent: totalEthSpent.toLocaleString(),
      totalUmaRepaid: totalUmaRepaid.toLocaleString()
    }
  };
}

async function parseClaimEvents(claimedRewards, priceData, multibar, rebateOutput) {
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

    const key = `${voter}-${roundId}-${identifier}-${requestTime}`;
    const val = {
      voter,
      roundId,
      requestTime,
      identifier,
      claim: {
        transactionBlock: transactionBlock.number,
        hash: transactionReceipt.transactionHash,
        gasUsed
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
    const ethToPay = toBN(priceData.averagePriceGweiForPeriod).mul(toBN(gasUsed));
    const umaToPay = ethToPay.mul(priceData.ethToUma).div(priceData.SCALING_FACTOR);
    const claimTxn = claimData.hash;

    totalGasUsed += gasUsed;
    totalEthSpent += Number(fromWei(ethToPay.toString()));
    totalUmaRepaid += Number(fromWei(umaToPay.toString()));

    rebateReceipts[voterKey] = {
      gasUsed,
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
      totalGasUsed: totalGasUsed.toLocaleString(),
      totalEthSpent: totalEthSpent.toLocaleString(),
      totalUmaRepaid: totalUmaRepaid.toLocaleString()
    }
  };
}

async function calculateRebate(_startDate, _endDate, _revealOnly, _claimOnly) {
  try {
    const voting = new web3.eth.Contract(VotingAbi.abi, "0x9921810C710E7c3f7A7C6831e30929f19537a545");

    const rebateNumber = 1;
    const endDate = _endDate ? _endDate : Math.round(Date.now() / 1000 - 60 * 5); // Default: Current time minus 5 minutes
    const startDate = _startDate ? _startDate : endDate - 60 * 60 * 24 * 3; // Default: End time - 3 days
    let endBlock, startBlock;
    try {
      endBlock = (await FindBlockAtTimestamp._findBlockNumberAtTimestamp(web3, Number(endDate))).blockNumber;
      startBlock = (await FindBlockAtTimestamp._findBlockNumberAtTimestamp(web3, Number(startDate))).blockNumber;
    } catch (err) {
      console.error(err);
    }
    console.log("\n\n*=======================================*");
    console.log("*                                       *");
    console.log("* 🐲⛽️ UMA Gas Rebater 🐲 ⛽️            *");
    console.log("*                                       *");
    console.log("*=======================================*");
    console.log(`- Calculating gas rebates from block ${startBlock} until ${endBlock}`);

    // Query past contract events.
    const [committedVotes, revealedVotes, claimedRewards] = await Promise.all([
      voting.getPastEvents("VoteCommitted", {
        fromBlock: 0
        // We don't specify a start date for commits because we want to make sure we can match each
        // reveal with a commit, even if the commit was prior to `start`.
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

    // TODO: Fetch gas price data
    const SCALING_FACTOR = toBN(toWei("1"));
    // - Get gas price for period.  This is the ETH price per unit gas, described in Gwei.
    const _averagePriceGweiForPeriod = "90";
    const averagePriceGweiForPeriod = toBN(toWei(_averagePriceGweiForPeriod, "gwei"));
    // - ETH-USD price for period
    const _averageEthPriceForPeriod = "435";
    const averageEthPriceForPeriod = toBN(toWei(_averageEthPriceForPeriod, "ether"));
    // - Current UMA-USD price
    const _currentUmaPriceForPeriod = await getUmaPrice();
    const currentUmaPriceForPeriod = toBN(toWei(_currentUmaPriceForPeriod.toString(), "ether"));
    // - Current UMA-ETH price
    const ethToUma = averageEthPriceForPeriod.mul(SCALING_FACTOR).div(currentUmaPriceForPeriod);

    const priceData = {
      averagePriceGweiForPeriod,
      averageEthPriceForPeriod,
      currentUmaPriceForPeriod,
      ethToUma,
      SCALING_FACTOR
    };
    console.log("\n\n*=======================================*");
    console.log("*                                       *");
    console.log("* 💎 Price Data 💎                      *");
    console.log("*                                       *");
    console.log("*=======================================*");
    Object.keys(priceData).forEach(k => {
      if (k.toLowerCase().includes("gwei")) {
        console.log(`- ${k}: ${fromWei(priceData[k].toString(), "gwei")}`);
      } else {
        console.log(`- ${k}: ${fromWei(priceData[k].toString())}`);
      }
    });

    // Final UMA rebates to send
    const rebateOutput = {
      rebate: rebateNumber,
      fromBlock: startBlock,
      toBlock: endBlock,
      shareHolderPayout: {} // {[voter:string]: amountUmaToRebate:number}
    };

    // Parallelize fetching of event data:
    const parsePromises = [];

    // Create new multi-bar CLI progress container
    const multibar = new cliProgress.MultiBar(
      {
        format: "{label} [{bar}] {percentage}% | ⏳ ETA: {eta}s | events parsed: {value}/{total}",
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: true
      },
      cliProgress.Presets.shades_classic
    );

    // Parse data for vote reveals to rebate.
    if (!_claimOnly) {
      parsePromises.push(parseRevealEvents(committedVotes, revealedVotes, priceData, multibar, rebateOutput));
    } else {
      parsePromises.push(null);
    }

    // Parse data for claimed rewards to rebate
    if (!_revealOnly) {
      parsePromises.push(parseClaimEvents(claimedRewards, priceData, multibar, rebateOutput));
    } else {
      parsePromises.push(null);
    }

    console.log("\n\n*=======================================*");
    console.log("*                                       *");
    console.log("* 🌏 Fetching Blockchain Data 🌎        *");
    console.log("*                                       *");
    console.log("*=======================================*");
    [revealRebates, claimRebates] = await Promise.all(parsePromises);

    console.log("\n\n*=======================================*");
    console.log("*                                       *");
    console.log("* ✅ Results                           *");
    console.log("*                                       *");
    console.log("*=======================================*");
    if (revealRebates) {
      console.table(revealRebates.rebateReceipts);
      console.log("㊗️ Reveal Totals:", revealRebates.totals);
    }
    if (claimRebates) {
      console.table(claimRebates.rebateReceipts);
      console.log("㊗️ Claim Totals:", claimRebates.totals);
    }
    // Output JSON parseable via disperse.app
    let totalUMAToRebate = 0;
    for (let voter of Object.keys(rebateOutput.shareHolderPayout)) {
      totalUMAToRebate += rebateOutput.shareHolderPayout[voter];
    }

    console.log("\n\n*=======================================*");
    console.log("*                                       *");
    console.log("* 🧮 Final UMA Rebate                   *");
    console.log("*                                       *");
    console.log("*=======================================*");
    console.log(`🎟 UMA to rebate: ${totalUMAToRebate}`);
    console.log(`📒 Output JSON: ${JSON.stringify(rebateOutput, null, 4)}`);

    // Format output and save to file.
    const savePath = `${path.resolve(__dirname)}/rebates/Rebate_${rebateNumber}.json`;
    fs.writeFileSync(savePath, JSON.stringify(rebateOutput, null, 4));
    console.log("🗄  File successfully written to", savePath);
  } catch (err) {
    console.error("calculateRebate ERROR:", err);
    return;
  }
}

async function getUmaPrice() {
  const query = "https://api.coingecko.com/api/v3/simple/price?ids=uma&vs_currencies=usd";

  const response = await fetch(query, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    }
  });

  let priceResponse = await response.json();
  return priceResponse.uma.usd;
}

// Implement async callback to enable the script to be run by truffle or node.
async function Main(callback) {
  try {
    // Pull the parameters from process arguments. Specifying them like this lets tests add its own.
    await calculateRebate(argv.start, argv.end, argv["reveal-only"], argv["claim-only"]);
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

module.exports = Main;
