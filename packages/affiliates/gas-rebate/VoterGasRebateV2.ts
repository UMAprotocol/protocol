// This is a script calculates the gas rebate for UMA protocol voters. The script finds all VoteCommitted and
// VoteRevealed events in a specified time range and calculates the gas used for each event. It then uses UniswapV3 swap
// events to find the UMA/ETH price at the block in which each event was included and calculates the ETH cost of the gas
// used in UMA tokens. The script aggregates the gas rebates by voter and saves the results to a file. // It is designed
// to not require any run time parameters by always running it one month after the desired output month.

import { getAddress } from "@uma/contracts-node";
import hre from "hardhat";
const { ethers } = hre as any;
import { BigNumber } from "ethers";
import moment from "moment";
import { findBlockNumberAtTimestamp, getWeb3 } from "@uma/common";
import fs from "fs";
import path from "path";

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
  // Function to process events sequentially
  const getTransactionsFromEvents = async (events: any) => {
    const transactions = [];
    for (const event of events) {
      const transaction = await voting.provider.getTransactionReceipt(event.transactionHash);
      transactions.push(transaction);
    }
    return transactions;
  };

  // Process commitEvents sequentially
  const commitTransactions = await getTransactionsFromEvents(commitEvents);

  // Process revealEvents sequentially
  const revealTransactions = await getTransactionsFromEvents(revealEvents);

  // The transactions to refund are the union of the commit and reveal transactions. We need to remove any duplicates
  // as a voter could have done multiple commits and reveals in the same transaction due to multicall. If we refund
  // the full gas used within a transaction then we will refund for all commit-reveal operations within that tx.
  const transactionsToRefund = [...commitTransactions, ...revealTransactions].reduce((accumulator, current) => {
    if (!accumulator.find((transaction: any) => transaction.transactionHash === current.transactionHash))
      accumulator.push(current);

    return accumulator;
  }, []);

  console.log(
    `In aggregate, refund ${commitEvents.length} commits and ${revealEvents.length} Reveals` +
      ` for a total of ${transactionsToRefund.length} transactions`
  );

  const shareholderPayoutBN: { [address: string]: BigNumber } = {};
  // Now, traverse all transactions and calculate the rebate for each.
  for (const transaction of transactionsToRefund) {
    // Eth used is the gas used * the gas price.
    const resultantRebate = transaction.gasUsed.mul(transaction.effectiveGasPrice);
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
