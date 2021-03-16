// Ingestor script that reads in a number of constituent payouts and generates a combined payouts file. An example of
// this usage would be to take in a) liquidity b) developer and c) dapp mining payouts and produce one combined output
// that would distribute all underlying rewards.

// To use this script, you need to include a number of parameters. A number of these parameters are expected to be structured
// as a sequential list of inputs. For example, when reading in multiple files a list of file paths is provided after
// the `-i` flag. See the example execution for the KPI options token-distribution below.

// ts-node ./scripts/0_MerklePayoutIngestor.ts --input ../../outputs/governance_recipients.json ../../outputs/uma_holder_recipients.json \
// ../../outputs/uma_user_recipients.json -- key null null null -- d 18 18 18 -- reason "KPI Options drop 1: Governance Recipient" \
// "KPI Options drop1: UMA Token Holder" "KPI Options drop1: UMA User" -- rewardToken 0x47B1EE6d02af0AA5082C90Ea1c2c14c70399186c -- chainId 42 -- windowIndex 0

import assert from "assert";
import path from "path";
import { program } from "commander";
import fs from "fs";
import Web3 from "web3";
const { toBN, isAddress, toChecksumAddress } = Web3.utils;
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
      const checkSumRecipientAddress = toChecksumAddress(recipientAddress); // Ensure consistent address case

      // Scale the amount by the number of decimals for that particular input.
      const recipientAmountScaled = ConvertDecimals(0, o.decimals[i], Web3)(recipients[recipientAddress]);

      // If the output file already contains information for this particular recipient, then append and add their rewards.
      // Else, simply init the object with their values from the file. Note that accountIndex in both cases is set to -1.
      // This will be set once the full data structure is built and ordered by payout amount.
      if (outputObject.recipients[checkSumRecipientAddress]) {
        outputObject.recipients[checkSumRecipientAddress] = {
          amount: toBN(outputObject.recipients[checkSumRecipientAddress].amount)
            .add(recipientAmountScaled)
            .toString(),
          metaData: [...outputObject.recipients[checkSumRecipientAddress].metaData, o.reason[i]],
          accountIndex: -1
        };
      } else {
        outputObject.recipients[checkSumRecipientAddress] = {
          amount: recipientAmountScaled.toString(),
          metaData: [o.reason[i]],
          accountIndex: -1
        };
      }
    });
  }

  // There should be only unique indices within this outputObject. If there are not, then something when wrong
  // in the previous step. This is critical to ensure that verifyProof works within the smart contracts.
  const uniqueIndices = [...new Set(Object.keys(outputObject.recipients))];
  assert(uniqueIndices.length === Object.keys(outputObject.recipients).length, "duplicate account indices");

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
