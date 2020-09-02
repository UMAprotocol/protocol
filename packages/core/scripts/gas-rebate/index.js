require("dotenv").config();
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

async function calculateRebate(_startDate, _endDate, _revealOnly, _claimOnly) {
  try {
    const web3 = new Web3(new Web3.providers.HttpProvider(process.env.CUSTOM_NODE_URL));
    const { toBN, toWei, fromWei } = web3.utils;
    const voting = new web3.eth.Contract(VotingAbi.abi, "0x9921810C710E7c3f7A7C6831e30929f19537a545");

    const weekNumber = 1;
    const endDate = _endDate ? _endDate : Math.round(Date.now() / 1000 - 60 * 5); // Default: Current time minus 5 minutes
    const startDate = _startDate ? _startDate : endDate - 60 * 60 * 24 * 3; // Default: End time - 3 days
    let endBlock, startBlock;
    try {
      endBlock = (await FindBlockAtTimestamp._findBlockNumberAtTimestamp(web3, Number(endDate))).blockNumber;
      startBlock = (await FindBlockAtTimestamp._findBlockNumberAtTimestamp(web3, Number(startDate))).blockNumber;
    } catch (err) {
      console.error(err);
    }
    console.log(`⛽️ Calculating gas rebates from block ${startBlock} until ${endBlock}`);

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
    const _currentUmaPriceForPeriod = "26.5";
    const currentUmaPriceForPeriod = toBN(toWei(_currentUmaPriceForPeriod, "ether"));
    // - Current UMA-ETH price
    const ethToUma = averageEthPriceForPeriod.mul(SCALING_FACTOR).div(currentUmaPriceForPeriod);

    // Final UMA rebates to send
    const rebateOutput = {
      week: weekNumber,
      fromBlock: startBlock,
      toBlock: endBlock,
      shareHolderPayout: {} // {[voter:string]: amountUmaToRebate:number}
    };

    // Parse data for vote reveals to rebate.
    if (!_claimOnly) {
      console.log("\n\n*=======================================*");
      console.log("*                                       *");
      console.log("* 📸 Parsing REVEAL data                *");
      console.log("*                                       *");
      console.log("*=======================================*");
      const revealVotersToRebate = {};

      const progressBarReveal = new cliProgress.SingleBar(
        {
          format: "Querying web3 [{bar}] {percentage}% | ⏳ ETA: {eta}s | events parsed: {value}/{total}"
        },
        cliProgress.Presets.shades_classic
      );
      progressBarReveal.start(revealedVotes.length, 0);

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
      console.log("✅ Finished parsing REVEAL data.");

      // Rebate voters
      console.log(`${Object.keys(revealVotersToRebate).length} Voters Revealed`);
      const rebateReceipts = {};
      let totalGasUsed = 0;
      let totalEthSpent = 0;
      let totalUmaRepaid = 0;
      for (let voterKey of Object.keys(revealVotersToRebate)) {
        const revealData = revealVotersToRebate[voterKey].reveal;
        const commitData = revealVotersToRebate[voterKey].reveal;
        const gasUsed = revealData.gasUsed + commitData.gasUsed;
        const ethToPay = toBN(averagePriceGweiForPeriod).mul(toBN(gasUsed));
        const umaToPay = ethToPay.mul(ethToUma).div(SCALING_FACTOR);
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

      console.table(rebateReceipts);
      console.log(
        `💎 Prices: {average gas price for period (gwei): ${_averagePriceGweiForPeriod}, average ETH-USD price for period: ${_averageEthPriceForPeriod}, current UMA-USD price: ${_currentUmaPriceForPeriod}}`
      );
      console.log(
        `㊗️ Totals: {gas: ${totalGasUsed.toLocaleString()}, ETH: ${totalEthSpent.toLocaleString()}, UMA: ${totalUmaRepaid.toLocaleString()}}`
      );
    }

    // Parse data for claimed rewards to rebate
    if (!_revealOnly) {
      console.log("\n\n*=======================================*");
      console.log("*                                       *");
      console.log("* 💴 Parsing CLAIM data                 *");
      console.log("*                                       *");
      console.log("*=======================================*");
      const rewardedVotersToRebate = {};

      const progressBarClaim = new cliProgress.SingleBar(
        {
          format: "Querying web3 [{bar}] {percentage}% | ⏳ ETA: {eta}s | events parsed: {value}/{total}"
        },
        cliProgress.Presets.shades_classic
      );
      progressBarClaim.start(claimedRewards.length, 0);

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
      console.log("✅ Finished parsing CLAIM data.");

      // Rebate voters
      console.log(`${Object.keys(rewardedVotersToRebate).length} Voters Claimed Rewards`);
      const rebateReceipts = {};
      let totalGasUsed = 0;
      let totalEthSpent = 0;
      let totalUmaRepaid = 0;
      for (let voterKey of Object.keys(rewardedVotersToRebate)) {
        const claimData = rewardedVotersToRebate[voterKey].claim;
        const gasUsed = claimData.gasUsed;
        const ethToPay = toBN(averagePriceGweiForPeriod).mul(toBN(gasUsed));
        const umaToPay = ethToPay.mul(ethToUma).div(SCALING_FACTOR);
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

      console.table(rebateReceipts);
      console.log(
        `💎 Prices: {average gas price for period (gwei): ${_averagePriceGweiForPeriod}, average ETH-USD price for period: ${_averageEthPriceForPeriod}, current UMA-USD price: ${_currentUmaPriceForPeriod}}`
      );
      console.log(
        `㊗️ Totals: {gas: ${totalGasUsed.toLocaleString()}, ETH: ${totalEthSpent.toLocaleString()}, UMA: ${totalUmaRepaid.toLocaleString()}}`
      );
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
    const savePath = `${path.resolve(__dirname)}/weekly-payouts/Week_${weekNumber}_Gas_Rebate.json`;
    fs.writeFileSync(savePath, JSON.stringify(rebateOutput, null, 4));
    console.log("🗄  File successfully written to", savePath);
  } catch (err) {
    console.error("calculateRebate ERROR:", err);
    return;
  }
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
