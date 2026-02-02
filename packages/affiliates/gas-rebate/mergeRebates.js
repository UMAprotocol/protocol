#!/usr/bin/env node
/**
 * Merge Gas Rebate Utility
 *
 * Merges two gas rebate JSON files into a single combined rebate.
 * Validates that block ranges are contiguous and in correct order.
 *
 * IMPORTANT: When splitting rebates across multiple runs, ensure you split at voting round
 * boundaries (end of reveal phase). Splitting mid-round could cause different results than
 * running a single rebate over the full range, since only one commit per round is rebated.
 *
 * Usage: node mergeRebates.js <rebate1.json> <rebate2.json> [output.json]
 *
 * Example: node mergeRebates.js rebates/Rebate_62.json rebates/Rebate_63.json rebates/Rebate_62_63_merged.json
 */

const fs = require("fs");
const path = require("path");

/**
 * Convert ETH float to wei BigInt for precise arithmetic.
 * Uses string manipulation to avoid floating point errors during conversion.
 */
function ethToWeiBigInt(ethValue) {
  // Convert to string and handle scientific notation
  const ethStr = ethValue.toFixed(18);
  const [intPart, decPart = ""] = ethStr.split(".");
  // Pad or truncate decimal part to 18 digits
  const paddedDec = decPart.padEnd(18, "0").slice(0, 18);
  const weiStr = intPart + paddedDec;
  // Remove leading zeros but keep at least one digit
  return BigInt(weiStr.replace(/^0+(?=\d)/, "") || "0");
}

/**
 * Convert wei BigInt back to ETH number.
 */
function weiBigIntToEth(weiBigInt) {
  const weiStr = weiBigInt.toString().padStart(19, "0"); // Ensure at least 19 chars for proper splitting
  const intPart = weiStr.slice(0, -18) || "0";
  const decPart = weiStr.slice(-18);
  return parseFloat(`${intPart}.${decPart}`);
}

function loadRebateFile(filePath) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf-8");
  return JSON.parse(content);
}

function validateBlockRanges(first, second) {
  // Validate that each file has valid internal block range
  if (first.fromBlock >= first.toBlock) {
    throw new Error(`First file has invalid block range: fromBlock (${first.fromBlock}) >= toBlock (${first.toBlock})`);
  }

  if (second.fromBlock >= second.toBlock) {
    throw new Error(
      `Second file has invalid block range: fromBlock (${second.fromBlock}) >= toBlock (${second.toBlock})`
    );
  }

  // Validate that files are in correct order
  if (first.toBlock >= second.fromBlock) {
    throw new Error(
      "Files are not in correct order or overlap.\n" +
        `First file ends at block ${first.toBlock}, second file starts at block ${second.fromBlock}.\n` +
        "The first file must end before the second file starts."
    );
  }

  // Validate no gaps between block ranges (allow for 1 block gap since toBlock of first could be 100 and fromBlock of second could be 101)
  const gap = second.fromBlock - first.toBlock;
  if (gap > 1) {
    throw new Error(
      "Gap detected between block ranges.\n" +
        `First file ends at block ${first.toBlock}, second file starts at block ${second.fromBlock}.\n` +
        `Gap: ${gap} blocks. Expected contiguous ranges (gap of at most 1 block).`
    );
  }
}

function validateVotingContracts(first, second) {
  if (first.votingContractAddress !== second.votingContractAddress) {
    throw new Error(
      "Voting contract addresses do not match.\n" +
        `First file: ${first.votingContractAddress}\n` +
        `Second file: ${second.votingContractAddress}`
    );
  }
}

function mergeShareholderPayouts(first, second) {
  // Convert all values to wei BigInt for precise arithmetic
  const mergedWei = {};

  for (const [address, amount] of Object.entries(first)) {
    mergedWei[address] = ethToWeiBigInt(amount);
  }

  for (const [address, amount] of Object.entries(second)) {
    const amountWei = ethToWeiBigInt(amount);
    if (mergedWei[address]) {
      mergedWei[address] = mergedWei[address] + amountWei;
    } else {
      mergedWei[address] = amountWei;
    }
  }

  // Convert back to ETH floats for output
  const merged = {};
  for (const [address, amountWei] of Object.entries(mergedWei)) {
    merged[address] = weiBigIntToEth(amountWei);
  }

  return merged;
}

function mergeRebates(first, second) {
  // Validate before merging
  validateVotingContracts(first, second);
  validateBlockRanges(first, second);

  // Merge shareholder payouts (uses wei-based arithmetic internally)
  const mergedPayout = mergeShareholderPayouts(first.shareholderPayout, second.shareholderPayout);

  // Calculate total rebate amount using wei precision
  const totalWei = Object.values(mergedPayout).reduce((sum, amount) => sum + ethToWeiBigInt(amount), 0n);
  const totalRebateAmount = weiBigIntToEth(totalWei);

  return {
    votingContractAddress: first.votingContractAddress,
    rebate: first.rebate, // Use first rebate number as base
    fromBlock: first.fromBlock,
    toBlock: second.toBlock,
    countVoters: Object.keys(mergedPayout).length,
    totalRebateAmount,
    shareholderPayout: mergedPayout,
  };
}

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: node mergeRebates.js <rebate1.json> <rebate2.json> [output.json]");
    console.log("\nExample:");
    console.log("  node mergeRebates.js rebates/Rebate_62.json rebates/Rebate_63.json");
    process.exit(1);
  }

  const [file1Path, file2Path, outputPath] = args;

  console.log("Loading rebate files...");
  const first = loadRebateFile(file1Path);
  const second = loadRebateFile(file2Path);

  console.log(`\nFirst file (Rebate ${first.rebate}):`);
  console.log(`  Block range: ${first.fromBlock} - ${first.toBlock}`);
  console.log(`  Voters: ${first.countVoters}`);
  console.log(`  Total: ${first.totalRebateAmount} ETH`);

  console.log(`\nSecond file (Rebate ${second.rebate}):`);
  console.log(`  Block range: ${second.fromBlock} - ${second.toBlock}`);
  console.log(`  Voters: ${second.countVoters}`);
  console.log(`  Total: ${second.totalRebateAmount} ETH`);

  console.log("\nValidating and merging...");
  console.log(
    "\n⚠️  WARNING: Ensure both rebate files were generated at voting round boundaries.\n" +
      "   Splitting mid-round could yield different results than a single run over the full range.\n"
  );
  const merged = mergeRebates(first, second);

  console.log("\nMerged result:");
  console.log(`  Block range: ${merged.fromBlock} - ${merged.toBlock}`);
  console.log(`  Voters: ${merged.countVoters}`);
  console.log(`  Total: ${merged.totalRebateAmount} ETH`);

  // Determine output path
  const defaultOutputPath = path.join(path.dirname(file1Path), `Rebate_${first.rebate}_${second.rebate}_merged.json`);
  const finalOutputPath = outputPath || defaultOutputPath;

  fs.writeFileSync(finalOutputPath, JSON.stringify(merged, null, 4));
  console.log(`\nMerged file saved to: ${finalOutputPath}`);
}

main();
