// This is a script calculates the gas rebate for UMA protocol voters. The script finds all VoteCommitted and
// VoteRevealed events in a specified time range and calculates the gas used for each event. It then uses UniswapV3 swap
// events to find the UMA/ETH price at the block in which each event was included and calculates the ETH cost of the gas
// used in UMA tokens. The script aggregates the gas rebates by voter and saves the results to a file. // It is designed
// to not require any run time parameters by always running it one month after the desired output month.

import { getAddress } from "@uma/contracts-node";
import hre from "hardhat";
const { ethers } = hre as any;
import { BigNumber } from "ethers";
import bn from "bignumber.js";
import moment from "moment";
import { findBlockNumberAtTimestamp, getWeb3, decodePriceSqrt } from "@uma/common";
import fs from "fs";
import path from "path";

// Find the closest UMA/ETH price to the given block number by searching through swap events in the given range.
function findClosestUmaEthPrice(swapEvents: any, blockNumber: number) {
  const closest = swapEvents.reduce((prev: any, curr: any) => {
    return Math.abs(curr.blockNumber - blockNumber) < Math.abs(prev.blockNumber - blockNumber) ? curr : prev;
  });
  // The returned price is of the form 1 UMA = x ETH. We want to return the price of 1 ETH in UMA. Also, Uniswap returns
  // the price in x96 square root encoded. We need to decode by reverse x96 operation by compting (price/(2^96))^2.
  // the casting from/to bn is needed to deal with the decimals returned by the decodePriceSqrt function.
  const basePrice = decodePriceSqrt(closest.args.sqrtPriceX96.toString());
  const bnPrice = new bn(ethers.utils.parseUnits("1").toString()).div(new bn(basePrice.toString()));
  return BigNumber.from(bnPrice.toString().toString().substring(0, bnPrice.toString().indexOf(".")));
}

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

  // Fetch associated block numbers for the start and end of the previous month.
  const fromBlock = (await findBlockNumberAtTimestamp(getWeb3(), prevMonthStart.getTime() / 1000)).blockNumber;
  const toBlock = (await findBlockNumberAtTimestamp(getWeb3(), prevMonthEnd.getTime() / 1000)).blockNumber;

  console.log("Current time:", moment(currentDate).format());
  console.log("Previous Month Start:", moment(prevMonthStart).format(), "& block", fromBlock);
  console.log("Previous Month End:", moment(prevMonthEnd).format(), "& block", toBlock);

  // Fetch all commit and reveal events.
  const voting = await ethers.getContractAt("VotingV2", await getAddress("VotingV2", 1));
  const commitEvents = await voting.queryFilter(voting.filters.VoteCommitted(), fromBlock, toBlock);
  const revealEvents = await voting.queryFilter(voting.filters.VoteRevealed(), fromBlock, toBlock);

  // For each event find the associated transaction. We want to refund all transactions that were sent by voters.
  const transactionsToRefund = await Promise.all(
    [
      commitEvents.map(async (commit: any) => voting.provider.getTransactionReceipt(commit.transactionHash)),
      revealEvents.map(async (reveal: any) => voting.provider.getTransactionReceipt(reveal.transactionHash)),
    ].flat()
  );

  console.log(
    `In aggregate, refund ${commitEvents.length} commits and ${revealEvents.length} Reveals` +
      ` for a total of ${transactionsToRefund.length} transactions`
  );

  // Find the associated UMA/ETH price for each transaction. We use the UniswapV3 pool to find the price at the block.
  // Note that we search for 10000 blocks before to ensure that the range over which we have data spans the entire range.
  const uniswapPool = await ethers.getContractAt("UniswapV3", "0x157dfa656fdf0d18e1ba94075a53600d81cb3a97");
  const uniswapPoolEvents = await uniswapPool.queryFilter(uniswapPool.filters.Swap(), fromBlock - 10000, toBlock);

  const shareholderPayoutBN: { [address: string]: BigNumber } = {};
  // Now, traverse all transactions and calculate the rebate for each.
  for (const transaction of transactionsToRefund) {
    // Eth used is the gas used * the gas price.
    const ethUsed = transaction.gasUsed.mul(transaction.effectiveGasPrice);
    // Find the nearest UMA/ETH price to the block in which the transaction was included.
    const associatedUmaEthPrice = findClosestUmaEthPrice(uniswapPoolEvents, transaction.blockNumber);
    // The rebate is the eth used * the price of 1 ETH in UMA.
    const resultantRebate = ethUsed.mul(associatedUmaEthPrice).div(ethers.utils.parseUnits("1"));
    // Save the output to the shareholderPayout object. Append to existing value if it exists.
    if (!shareholderPayoutBN[transaction.from]) shareholderPayoutBN[transaction.from] = BigNumber.from(0);
    shareholderPayoutBN[transaction.from] = shareholderPayoutBN[transaction.from].add(resultantRebate);
  }

  // Create a formatted output that is not bignumbers.
  const shareholderPayout: { [key: string]: number } = {};
  for (const [key, value] of Object.entries(shareholderPayoutBN))
    shareholderPayout[key] = parseFloat(ethers.utils.formatEther(value));

  // Now save the output. First, work out the next rebate number by looking at previous rebate files.
  const basePath = `${path.resolve(__dirname)}/rebates/`;
  const rebates = fs.readdirSync(basePath);
  const previousRebates = rebates.map((f) => parseInt(f.substring(f.indexOf("_") + 1, f.indexOf("."))));
  const rebateNumber = Math.max.apply(null, previousRebates) + 1;
  console.log("The next rebate number is", rebateNumber);

  // Then create the output object and save it.
  const finalOutputObject = {
    votingContractAddress: voting.address,
    rebate: rebateNumber,
    fromBlock,
    toBlock,
    countVoters: Object.keys(shareholderPayout).length,
    totalRebateAmount: parseFloat(
      ethers.utils.formatEther(
        Object.values(shareholderPayoutBN)
          .reduce((a, b) => a.add(b), BigNumber.from(0))
          .toString(),
        shareholderPayout
      )
    ),
    shareholderPayout,
  };
  const savePath = `${path.resolve(__dirname)}/rebates/Rebate_${rebateNumber}.json`;
  fs.writeFileSync(savePath, JSON.stringify(finalOutputObject, null, 4));
  console.log("🗄  File successfully written to", savePath);
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.log("error", error);
      process.exit(1);
    });
}
