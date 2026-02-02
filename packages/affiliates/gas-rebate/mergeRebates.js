#!/usr/bin/env node
/**
 * Merge Gas Rebate Utility
 *
 * Merges two gas rebate JSON files into a single combined rebate.
 * Validates that block ranges are contiguous and in correct order.
 *
 * Usage: node mergeRebates.js <rebate1.json> <rebate2.json> [output.json]
 *
 * Example: node mergeRebates.js rebates/Rebate_62.json rebates/Rebate_63.json rebates/Rebate_62_63_merged.json
 */

const fs = require("fs");
const path = require("path");

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
  const merged = { ...first };

  for (const [address, amount] of Object.entries(second)) {
    if (merged[address]) {
      merged[address] = merged[address] + amount;
    } else {
      merged[address] = amount;
    }
  }

  return merged;
}

function mergeRebates(first, second) {
  // Validate before merging
  validateVotingContracts(first, second);
  validateBlockRanges(first, second);

  // Merge shareholder payouts
  const mergedPayout = mergeShareholderPayouts(first.shareholderPayout, second.shareholderPayout);

  // Calculate total rebate amount from merged payouts (more accurate than summing totals due to floating point)
  const totalRebateAmount = Object.values(mergedPayout).reduce((sum, amount) => sum + amount, 0);

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
