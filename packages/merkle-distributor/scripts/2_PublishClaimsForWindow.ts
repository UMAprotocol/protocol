// Read in a JSON file and containing claims information, merkle roots and proofs and upload the file to IPFS, Cloudflare
// KV and add the merkle root on-chain. The script runs a number of sanity checks against the inputs. Note that this script
// has a number of dependencies to execute correctly. In particular the script assumes the following:
// 1) the unlocked account running the script is the owner of the merkleDistributor OR an account with permissions to set merkle roots.
// 2) the account running the script has sufficient rewards tokens to seed the merkleDistributor.
// 3) you have set the CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_NAMESPACE_ID and CLOUDFLARE_TOKEN env variables.
// 4) (optional) you have set the PINATA_SECRET_API_KEY and PINATA_API_KEY environment variables.

// Example input file should conform to the following format:
// {
// "chainId": 42,
// "rewardToken": "0x47B1EE6d02af0AA5082C90Ea1c2c14c70399186c",
// "windowIndex": 0,
// "totalRewardsDistributed": "15000000000000000000",
// "merkleRoot": "0x1b1b3e8a64b815fe4dd6f42c11dae9e9ff9ceb3d8f295052bc0c02a326aa9dc2",
// "claims": {
//   "0x00b591bc2b682a0b30dd72bac9406bfa13e5d3cd": {
//     "amount": "1000000000000000000",
//     "metaData": { "reason": ["YD-WETH-21 Liquidity Mining Week 27"] },
//     "windowIndex": 0,
//     "accountIndex": 0,
//     "proof": [
//       "0x62465ff033d171eb8bdeee2601be357027af3b7bea19d422b3797ad5c803f576",
//       "0xf0987f2e0ec07c35d7cfdd4f5831d8ef2a1829413321611caecbf08eaddf567c",
//       "0xedd0b39fe99a555994df53dfca180b84437abbd1b808fbadd5e8a70f7f2a40cf"
//     ]
//   }... for all claims
// }

// example execution: ts-node ./scripts/2_PublishClaimsForWindow.ts -i ./proof-files/chain-id-42-reward-window-0-claims-file.json -m 0xAfCd2405298C2FABB2F7fCcEB919B4505A6bdDFC --network kovan_mnemonic

import assert from "assert";
import { program } from "commander";
import fs from "fs";

import { getAbi } from "@uma/core";
import { getWeb3, MAX_UINT_VAL } from "@uma/common";
const web3 = getWeb3();
const { toBN } = web3.utils;

import IpfsHelper from "../src/IpfsHelper";
const ipfsHelper = IpfsHelper(process.env.PINATA_API_KEY, process.env.PINATA_SECRET_API_KEY);
import CloudflareHelper from "../src/CloudflareKVHelper";
const cfHelper = CloudflareHelper(
  process.env.CLOUDFLARE_ACCOUNT_ID,
  process.env.CLOUDFLARE_NAMESPACE_ID,
  process.env.CLOUDFLARE_TOKEN
);

program
  .option("-n --network")
  .requiredOption("-i, --input <path>", "input JSON file location containing a recipients payout")
  .requiredOption("-m, --merkleDistributorAddress <address>", "address of the merkle distributor contract")
  .parse(process.argv);

const options = program.opts();

const claimsObject = JSON.parse(fs.readFileSync(options.input, { encoding: "utf8" }));

// We can't easily do runtime verification of JSON file types in typescript. We could use a JSON scheme, but to keep
// things simple for now we can just double check that some important keys are present within the JSON file.
if (typeof claimsObject !== "object") throw new Error("Invalid JSON");
const expectedKeys = ["chainId", "rewardToken", "windowIndex", "totalRewardsDistributed", "claims"];
expectedKeys.forEach(expectedKey => {
  if (!Object.keys(claimsObject).includes(expectedKey)) {
    throw new Error("claims object missing expected key");
  }
});

const merkleDistributor = new web3.eth.Contract(getAbi("MerkleDistributor"), options.merkleDistributorAddress);

async function main() {
  const account = (await web3.eth.getAccounts())[0];

  // Do some basic sanity checks.
  console.log("0. Running some basic sanity checks on the payout file 🔎");
  assert(web3.utils.isAddress(options.merkleDistributorAddress), "Invalid merkleDistributorAddress");
  assert((await merkleDistributor.methods.owner().call()) == account, "Unlocked account does not own the distributor");
  assert((await web3.eth.net.getId()) == claimsObject.chainId, "The connected network not match your  JSON chainId");
  assert(web3.utils.isAddress(claimsObject.rewardToken), "Invalid rewardToken" + claimsObject.rewardToken);
  assert((await merkleDistributor.methods.lastCreatedIndex().call()) == claimsObject.windowIndex, "Wrong windowIndex");

  console.log("File passed the checks\n\n1. Adding claims file to IPFS 🛰");

  const ipfsHash = await ipfsHelper.uploadFile(JSON.stringify(claimsObject.claims));

  console.log("Claims file added to IPFS with hash:", ipfsHash, "\n\n2. Pinning claims file to IPFS 📌");

  // Pinning a file on IPFS makes it persistently accessible. This method pins the files with Infura and pinata.
  await ipfsHelper.pinHash(ipfsHash);

  console.log("Claims file pinned to IPFS!\n\n3. Adding claims file to cloudflare KV 🗺");

  await cfHelper.addClaimsToKV(claimsObject.claims, claimsObject.chainId, claimsObject.windowIndex);

  console.log("Claims file added to cloudflareKV!\n\n4. Updating the lookup claims indices 🔭");

  await cfHelper.updateChainWindowIndicesFromKV(
    claimsObject.chainId,
    claimsObject.windowIndex,
    ipfsHash,
    claimsObject.rewardToken,
    claimsObject.totalRewardsDistributed
  );

  console.log("\n5. Checking allowance in payment token 💸");
  const rewardToken = new web3.eth.Contract(getAbi("ExpandedERC20"), claimsObject.rewardToken);
  const currentRewardAllowance = await rewardToken.methods.allowance(account, options.merkleDistributorAddress).call();

  if (toBN(currentRewardAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
    console.log("Reward token allowance is too little to make this payment. Sending a transaction to increase it...");
    const approveTx = await rewardToken.methods
      .approve(options.merkleDistributorAddress, MAX_UINT_VAL)
      .send({ from: account });
    console.log("Increased reward token allowance with tx:", approveTx.transactionHash);
  } else console.log("Already have sufficient allowance on payment token");

  console.log("\n6. Creating transaction to upload merkle root 🧙");
  const setWindowTtx = await merkleDistributor.methods
    .setWindow(claimsObject.totalRewardsDistributed, claimsObject.rewardToken, claimsObject.merkleRoot, ipfsHash)
    .send({ from: account });

  console.log("Your merkle root has been added on-chain! 🕺 tx:", setWindowTtx.transactionHash);
}

main().catch(e => {
  console.log(e);
  process.exit(1);
});
