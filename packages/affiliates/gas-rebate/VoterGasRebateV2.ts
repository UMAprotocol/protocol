// This is a script calculates the gas rebate for UMA protocol voters. The script finds all VoteCommitted and
// VoteRevealed events in a specified time range and calculates the gas used for each event. It then uses UniswapV3 swap
// events to find the UMA/ETH price at the block in which each event was included and calculates the ETH cost of the gas
// used in UMA tokens. The script aggregates the gas rebates by voter and saves the results to a file. // It is designed
// to not require any run time parameters by always running it one month after the desired output month.

import "@nomiclabs/hardhat-ethers";
import { findBlockNumberAtTimestamp, getWeb3 } from "@uma/common";
import { getAddress } from "@uma/contracts-node";
import type { VotingV2 } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/VotingV2";
import fs from "fs";
import hre from "hardhat";
import moment from "moment";
import path from "path";
import { calculateVoterGasRebateV2, writeMonthlyAuditReports } from "./voterGasRebateV2Utils";
const { ethers } = hre;

const {
  OVERRIDE_FROM_BLOCK,
  OVERRIDE_TO_BLOCK,
  TRANSACTION_CONCURRENCY,
  MAX_RETRIES,
  RETRY_DELAY,
  MIN_STAKED_TOKENS,
  MAX_PRIORITY_FEE_GWEI,
  MAX_BLOCK_LOOK_BACK,
} = process.env;

export async function run(): Promise<void> {
  console.log("Running UMA2.0 Gas rebate script! This script assumes you are running it for the previous month🍌.");

  // Work out the range to run over. This should be over the totality of the previous month. Note we use the UTC month
  // methods to ensure that the same output is always created irrespective of timezones.
  const currentDate = new Date();
  const prevMonthStart = new Date(currentDate);
  prevMonthStart.setUTCMonth(prevMonthStart.getUTCMonth() - 1);
  prevMonthStart.setUTCDate(1);
  prevMonthStart.setUTCHours(0, 0, 0, 0);

  const prevMonthEnd = new Date(prevMonthStart.getUTCFullYear(), prevMonthStart.getUTCMonth() + 1, 0);
  prevMonthEnd.setUTCHours(23, 59, 59);

  const transactionConcurrency = TRANSACTION_CONCURRENCY ? Number(TRANSACTION_CONCURRENCY) : 50;

  // Fetch associated block numbers for the start and end of the previous month.
  const fromBlock = OVERRIDE_FROM_BLOCK
    ? Number(OVERRIDE_FROM_BLOCK)
    : (await findBlockNumberAtTimestamp(getWeb3(), prevMonthStart.getTime() / 1000)).blockNumber;

  const toBlock = OVERRIDE_TO_BLOCK
    ? Number(OVERRIDE_TO_BLOCK)
    : (await findBlockNumberAtTimestamp(getWeb3(), prevMonthEnd.getTime() / 1000)).blockNumber;

  // Minimum UMA tokens staked to be eligible for a rebate
  const minTokens = ethers.utils.parseEther(MIN_STAKED_TOKENS ? MIN_STAKED_TOKENS : "500");
  const maxPriorityFee = MAX_PRIORITY_FEE_GWEI ? ethers.utils.parseUnits(MAX_PRIORITY_FEE_GWEI, "gwei") : null;
  const maxBlockLookBack = MAX_BLOCK_LOOK_BACK ? Number(MAX_BLOCK_LOOK_BACK) : 250;
  const retryConfig = {
    retries: MAX_RETRIES ? Number(MAX_RETRIES) : 10,
    delay: RETRY_DELAY ? Number(RETRY_DELAY) : 1000,
  };

  console.log("Minimum UMA tokens staked to be eligible for a rebate:", ethers.utils.formatEther(minTokens));
  console.log("Current time:", moment(currentDate).format());
  console.log("Previous Month Start:", moment(prevMonthStart).format(), "& block", fromBlock);
  console.log("Previous Month End:", moment(prevMonthEnd).format(), "& block", toBlock);
  console.log("Gas rebate V2 config:", {
    fromBlock,
    toBlock,
    minStakedTokens: ethers.utils.formatEther(minTokens),
    maxPriorityFeeGwei: maxPriorityFee ? ethers.utils.formatUnits(maxPriorityFee, "gwei") : null,
    maxBlockLookBack,
    transactionConcurrency,
  });

  // Fetch all commit and reveal events.
  const voting = (await hre.ethers.getContractAt("VotingV2", await getAddress("VotingV2", 1))) as VotingV2;

  const rebateComputation = await calculateVoterGasRebateV2({
    voting,
    fromBlock,
    toBlock,
    minTokens,
    maxBlockLookBack,
    transactionConcurrency,
    maxPriorityFee,
    retryConfig,
  });

  console.log("VotingV2 event collection stats:", rebateComputation.eventCollectionStats);
  if (rebateComputation.anomalies.length > 0) {
    console.log("VotingV2 event collection anomalies:", rebateComputation.anomalies);
  }

  console.log(
    `In aggregate, refund ${rebateComputation.commitEvents.length} commits and ` +
      `${rebateComputation.revealEvents.length} Reveals for a total of ` +
      `${rebateComputation.transactionsToRefund.length} transactions`
  );

  if (maxPriorityFee) {
    console.log("Max priority fee to refund:", ethers.utils.formatUnits(maxPriorityFee, "gwei"), "gwei");
  } else {
    console.log("No priority fee cap applied");
  }

  // Create a formatted output that is not bignumbers.
  const shareholderPayout: { [key: string]: number } = {};
  for (const [key, value] of Object.entries(rebateComputation.shareholderPayoutWei))
    shareholderPayout[key] = parseFloat(ethers.utils.formatEther(value));

  // Now save the output. First, work out the next rebate number by looking at previous rebate files.
  const basePath = `${path.resolve(__dirname)}/rebates/`;
  const rebates = fs.readdirSync(basePath);
  const previousRebates = rebates
    .map((fileName) => fileName.match(/^Rebate_(\d+)\.json$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => parseInt(match[1], 10));
  const rebateNumber = Math.max.apply(null, previousRebates) + 1;
  console.log("The next rebate number is", rebateNumber);

  // Then create the output object and save it.
  const finalOutputObject = {
    votingContractAddress: voting.address,
    rebate: rebateNumber,
    fromBlock,
    toBlock,
    countVoters: Object.keys(shareholderPayout).length,
    totalRebateAmount: parseFloat(ethers.utils.formatEther(rebateComputation.totalRebateWei.toString())),
    shareholderPayout,
  };
  const savePath = `${path.resolve(__dirname)}/rebates/Rebate_${rebateNumber}.json`;
  fs.writeFileSync(savePath, JSON.stringify(finalOutputObject, null, 4));
  console.log("🗄  File successfully written to", savePath);

  const auditReports = writeMonthlyAuditReports(rebateComputation, {
    outputRebateFilePath: savePath,
    rebateNumber,
    config: {
      minStakedTokens: ethers.utils.formatEther(minTokens),
      minStakedTokensWei: minTokens.toString(),
      maxPriorityFeeGwei: maxPriorityFee ? ethers.utils.formatUnits(maxPriorityFee, "gwei") : null,
      maxPriorityFeeWei: maxPriorityFee ? maxPriorityFee.toString() : null,
      maxBlockLookBack,
      transactionConcurrency,
      maxRetries: retryConfig.retries,
      retryDelay: retryConfig.delay,
      overrideFromBlockConfigured: Boolean(OVERRIDE_FROM_BLOCK),
      overrideToBlockConfigured: Boolean(OVERRIDE_TO_BLOCK),
      customNodeUrlConfigured: Boolean(process.env.CUSTOM_NODE_URL),
    },
  });
  console.log("Monthly audit JSON written to", auditReports.jsonPath);
  console.log("Monthly audit Markdown written to", auditReports.markdownPath);
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.log("error", error);
      process.exit(1);
    });
}
