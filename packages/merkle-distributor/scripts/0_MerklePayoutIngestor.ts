import assert from "assert";
import path from "path";
import { program } from "commander";
import fs from "fs";
import Web3 from "web3";
const { toWei, toBN, isAddress } = Web3.utils;
import { ConvertDecimals } from "@uma/common";

program
  .requiredOption("-i, --input <paths...>", "input path(s) to input JSON files to be ingested")
  .requiredOption("-k, --key <payoutKey...>", "key within JSON file to donate the payout recipients")
  .requiredOption("-d, --decimals <payoutDecimals...>", "Decimal scalar to scale the payouts by")
  .requiredOption("-r, --reason <payoutReason...>", "Why the recipients within the payout file are getting the payout")
  .requiredOption("-t, --rewardToken <rewardToken>", "ERC20 token address used for the payouts")
  .requiredOption("-c, --chainId <chain index>", "Ethereum chain ID intended for the payouts to be sent on")
  .requiredOption("-w, --windowIndex <number>", "Index to uniquely define this set of payouts")
  .parse(process.argv);

const o = program.opts();
assert(
  o.input.length == o.key.length && o.input.length == o.decimals.length && o.input.length == o.reason.length,
  "Malformed inputs. Script expects equal number of input files, keys per file, decimals per payout file and reason for payouts"
);
assert(o.chainId == 1 || o.chainId == 42, "Invalid ChainId. Only mainnet and kovan are supported.");
assert(isAddress(o.rewardToken), "Invalid rewardToken" + o.rewardToken);

async function main() {
  console.log("Running claims ingestion script 🎂");

  // Add initial params to payout object and define the type
  const outputObject: {
    chainId: number;
    rewardToken: string;
    windowIndex: number;
    totalRewardsDistributed: string;
    recipients: {
      [key: string]: { amount: string; metaData: Array<string>; accountIndex: number };
    };
  } = {
    chainId: Number(o.chainId),
    rewardToken: o.rewardToken,
    windowIndex: Number(o.windowIndex),
    totalRewardsDistributed: "0", // Initialized after all data read in. Sum of all rewards.
    recipients: {} // Built up from the n input files defined in the params.
  };

  // Build up payouts for recipients for each input file.
  for (let i = 0; i < o.input.length; i++) {
    const inputFile = JSON.parse(fs.readFileSync(o.input[i], { encoding: "utf8" }));

    // Fetch the recipients from the input file. The key donates the identifier within the input file. if this is null
    // then the input file has no nested structures and only contains the recipients.
    const recipients = o.key == "null" ? inputFile[o.key] : inputFile;
    Object.keys(recipients).forEach((recipientAddress: string) => {
      // Scale the amount by the number of decimals for that particular input.
      const recipientAmountScaled = ConvertDecimals(0, o.decimals[i], Web3)(recipients[recipientAddress]);

      // If the output file already contains information for this particular recipient, then append and add their rewards.
      // Else, simply init the object with their values from the file. Note that accountIndex in both cases is set to 0.
      // This will be set once the full data structure is built and ordered by payout amount.
      if (outputObject.recipients[recipientAddress]) {
        outputObject.recipients[recipientAddress] = {
          amount: toBN(outputObject.recipients[recipientAddress].amount)
            .add(recipientAmountScaled)
            .toString(),
          metaData: [...outputObject.recipients[recipientAddress].metaData, o.reason[i]],
          accountIndex: 0
        };
      } else {
        outputObject.recipients[recipientAddress] = {
          amount: recipientAmountScaled.toString(),
          metaData: [o.reason[i]],
          accountIndex: 0
        };
      }
    });
  }

  // Sort the outputs payment amount.
  outputObject.recipients = Object.fromEntries(
    Object.entries(outputObject.recipients).sort(([, a], [, b]) => (toBN(a.amount).gt(toBN(b.amount)) ? -1 : 0))
  );

  // Append an index to each recipient and count the totalRewardsDistributed.
  let totalRewardsDistributed = toBN("0");
  Object.keys(outputObject.recipients).forEach((recipientAddress: string, index: number) => {
    outputObject.recipients[recipientAddress].accountIndex = index;
    totalRewardsDistributed = totalRewardsDistributed.add(toBN(outputObject.recipients[recipientAddress].amount));
  });
  outputObject.totalRewardsDistributed = totalRewardsDistributed.toString();

  // Finally, write the file to disk.
  const savePath = `${path.resolve(__dirname)}/../payout-files/chain-id-${outputObject.chainId}-reward-window-${
    outputObject.windowIndex
  }-payouts.json`;
  fs.writeFileSync(savePath, JSON.stringify(outputObject));
  console.log("🗄  File successfully written to", savePath);
}

main().catch(e => {
  console.log(e);
  process.exit(1);
});
