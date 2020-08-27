const cliProgress = require("cli-progress");
const argv = require("minimist")(process.argv.slice(), { string: ["start", "end"], boolean: ['reveal-only'] });
const Voting = artifacts.require("Voting");

const TEST_START_BLOCK = 10606000;

const { toBN, toWei, fromWei } = web3.utils;

const CalculateRebate = async callback => {
  try {
    const startBlock = argv.start ? argv.start : TEST_START_BLOCK;
    const endBlock = (await web3.eth.getBlock("latest")).number;
    const voting = await Voting.deployed();
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
    const SCALING_FACTOR = toBN(toWei("1"))
    // - Get gas price for period.  This is the ETH price per unit gas, described in Gwei.
    const averagePriceGweiForPeriod = toBN(toWei("90", "gwei"));
    // - ETH-USD price for period
    const averageEthPriceForPeriod = toBN(toWei("400", "ether"));
    // - UMA-USD price for period
    const averageUmaPriceForPeriod = toBN(toWei("10", "ether"));
    // - UMA-ETH price for period
    const ethToUma = averageEthPriceForPeriod.mul(SCALING_FACTOR).div(averageUmaPriceForPeriod)    

    // Parse data for vote reveals to rebate.
    console.group("📸 Parsing REVEAL data:");
    const revealVotersToRebate = {};

    const progressBarReveal = new cliProgress.SingleBar(
      {
        format: "[{bar}] {percentage}% | reveal events parsed: {value}/{total}"
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
      const gasUsed = parseInt(transactionReceipt.gasUsed, 16);

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
    console.groupEnd();
    console.log("✅ Finished parsing REVEAL data.");

    // Rebate voters
    console.log(`${Object.keys(revealVotersToRebate).length} Voters Revealed`);
    const rebateReceipts = {}
    for (let voterKey of Object.keys(revealVotersToRebate)) {
      const revealData = revealVotersToRebate[voterKey].reveal;
      const commitData = revealVotersToRebate[voterKey].reveal;
      const gasUsed = revealData.gasUsed + commitData.gasUsed;
      const ethToPay = toBN(averagePriceGweiForPeriod).mul(toBN(gasUsed))
      const umaToPay = ethToPay.mul(ethToUma).div(SCALING_FACTOR)
      const commitTxn = commitData.hash;
      const revealTxn = revealData.hash

      rebateReceipts[voterKey] = {
        gasUsed,
        ethToPay: Number(fromWei(ethToPay)),
        umaToPay: Number(fromWei(umaToPay)),
        commitTxn,
        revealTxn
      }
    }

    console.table(rebateReceipts)    

    // Parse data for claimed rewards to rebate
    if (!argv['reveal-only']) {
      console.group("💴 Parsing CLAIM data:");
      const rewardedVotersToRebate = {};
  
      const progressBarClaim = new cliProgress.SingleBar(
        {
          format: "[{bar}] {percentage}% | claim events parsed: {value}/{total}"
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
        const gasUsed = parseInt(transactionReceipt.gasUsed, 16);
  
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
      console.groupEnd();
      console.log("✅ Finished parsing CLAIM data.");  

      console.log(`${Object.keys(rewardedVotersToRebate).length} Voters Claimed Rewards`);
      for (let voterKey of Object.keys(rewardedVotersToRebate)) {
        const claimData = rewardedVotersToRebate[voterKey].claim;
        const gasUsed = claimData.gasUsed;
        const voter = rewardedVotersToRebate[voterKey].voter;
        const identifier = rewardedVotersToRebate[voterKey].identifier;
        const round = rewardedVotersToRebate[voterKey].roundId
        const txnHash = claimData.hash

        const ethToPay = toBN(averagePriceGweiForPeriod).mul(toBN(gasUsed))
        const umaToPay = ethToPay.mul(ethToUma).div(SCALING_FACTOR)
        console.log(`CLAIM (${voter.substring(0,6)}...) gas ${gasUsed} (ETH): ${fromWei(ethToPay)}  (UMA): ${fromWei(umaToPay)} (${identifier}-${round}) (tx: ${txnHash})`);
      }
    }
  } catch (err) {
    callback(err);
    return;
  }
  callback();
};

module.exports = CalculateRebate;
