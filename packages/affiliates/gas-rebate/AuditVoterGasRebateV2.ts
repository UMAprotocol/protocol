// VotingV2-only correction audit script. It recomputes paid rebate files from a manifest,
// diffs exact wei amounts, and writes a consolidated positive top-up payout.

import "@nomiclabs/hardhat-ethers";
import { getAddress } from "@uma/contracts-node";
import type { VotingV2 } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/VotingV2";
import hre from "hardhat";
import path from "path";
import { runVotingV2CorrectionAudit } from "./voterGasRebateV2Utils";

const { AUDIT_MANIFEST, OUTPUT_DIR, ALLOW_OVERWRITE, MAX_RETRIES, RETRY_DELAY, CUSTOM_NODE_URL } = process.env;

function requireEnvironmentVariable(value: string | undefined, name: string): string {
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required for VotingV2 correction audit mode`);
  }
  return value;
}

export async function run(): Promise<void> {
  requireEnvironmentVariable(CUSTOM_NODE_URL, "CUSTOM_NODE_URL");
  const manifestPath = path.resolve(process.cwd(), requireEnvironmentVariable(AUDIT_MANIFEST, "AUDIT_MANIFEST"));
  const outputDir = OUTPUT_DIR
    ? path.resolve(process.cwd(), OUTPUT_DIR)
    : path.resolve(process.cwd(), "gas-rebate/corrections");
  const expectedVotingV2Address = await getAddress("VotingV2", 1);
  const voting = (await hre.ethers.getContractAt("VotingV2", expectedVotingV2Address)) as VotingV2;
  const retryConfig = {
    retries: MAX_RETRIES ? Number(MAX_RETRIES) : 10,
    delay: RETRY_DELAY ? Number(RETRY_DELAY) : 1000,
  };

  console.log("Running VotingV2 gas rebate correction audit");
  console.log("Manifest:", manifestPath);
  console.log("Output directory:", outputDir);
  console.log("Overwrite enabled:", ALLOW_OVERWRITE === "true");

  const written = await runVotingV2CorrectionAudit({
    manifestPath,
    voting,
    outputDir,
    expectedVotingContractAddress: expectedVotingV2Address,
    baseDir: process.cwd(),
    allowOverwrite: ALLOW_OVERWRITE === "true",
    customNodeUrlConfigured: true,
    retryConfig,
  });

  console.log("Correction payout JSON written to", written.payoutPath);
  console.log("Correction audit JSON written to", written.auditJsonPath);
  console.log("Correction audit Markdown written to", written.auditMarkdownPath);
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.log("error", error);
      process.exit(1);
    });
}
