// This script deploys DesignatedVotingV2 contracts and produces a gnosis-safe JSON file that can be used to fund the contracts.

const hre = require("hardhat");
import { utils } from "ethers";
import path from "path";
import fs from "fs";

import { DesignatedVotingV2FactoryEthers, VotingTokenEthers, VotingV2Ethers } from "@uma/contracts-node";
import { getContractInstance } from "../utils/contracts";

import { baseSafePayload, appendTxToSafePayload } from "../utils/gnosisPayload";

async function main() {
  const networkId = Number(await hre.getChainId());
  console.log("Running DesignatedVotingV2 deployments🔥\nChainId:", networkId);

  if (networkId != 1) throw new Error("Can only run on mainnet");
  const owner = process.env.SAFE_ADDRESS || "";

  // Replace hot wallets based on provided env variable.
  // Note: the env variable should be formatted as follows:
  // WALLET_AMOUNT_PAIRS="0x1234:500,0x9abc:10000"
  const walletsAndAmounts = (process.env.WALLET_AMOUNT_PAIRS?.split(",") || []).map((walletAmountPair) => {
    // Split by ":".
    const [wallet, amount] = walletAmountPair.split(":");
    if (!wallet || !amount) throw new Error("Invalid HOT_WALLET_REPLACEMENTS provided");
    // Ensure that the address and amount are formatted consistently.
    return { hotWallet: utils.getAddress(wallet), amount: utils.parseEther(amount).toString() };
  });

  // Log all designated voting and the associated hot wallets.
  console.log(`Deploying the following DV wallets for owner ${owner}:`);
  console.table(walletsAndAmounts);

  // Construct payload to deploy new DesignatedVotingV2 contracts for each hot wallet.
  const factoryV2 = await getContractInstance<DesignatedVotingV2FactoryEthers>("DesignatedVotingV2Factory");
  const designatedVotingData: { hotWallet: string; amount: string; dvAddress: string }[] = [];
  for (const walletAndAmount of walletsAndAmounts) {
    const { hotWallet } = walletAndAmount;
    const response = await factoryV2.newDesignatedVoting(owner, hotWallet);
    const receipt = await response.wait();
    const dvAddress = receipt.events?.find((event: any) => event.event === "NewDesignatedVoting")?.args
      ?.designatedVoting;

    if (!dvAddress) throw new Error(`Could not find DesignatedVotingCreated event for tx hash ${response.hash}`);
    designatedVotingData.push({ ...walletAndAmount, dvAddress });
  }

  // Log the designated voting contracts that were deployed.
  console.log("Deployed the following DesignatedVotingV2 contracts:");
  console.table(designatedVotingData);

  // Construct the JSON file to instruct the gnosis safe to fund, stake, and delegate the designated voting contracts.

  // Step 5: construct the gnosis payload to submit the migration process for each of the designated voting contracts.
  let payload = baseSafePayload(1, "Load DV Contracts.", `Loads DV contracts and sets up permissions`, owner);
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");
  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2");
  for (const { amount, dvAddress } of designatedVotingData) {
    // 1. Create payload to send tokens to new designated voting contract.
    payload = appendTxToSafePayload(payload, votingToken.address, transferInput, {
      recipient: dvAddress,
      amount,
    });

    // 2. Create payload to stake tokens in new designated voting contract.

    payload = appendTxToSafePayload(payload, dvAddress, stakeInput, {
      amount: amount,
      votingContract: votingV2.address,
    });

    // 3. Create payload to delegate to voter in new designated voting contract.
    payload = appendTxToSafePayload(payload, dvAddress, delegateToVoter, {});
  }

  const savePath = `${path.resolve(__dirname)}/load_dv_contracts.json`;
  fs.writeFileSync(savePath, JSON.stringify(payload, null, 4));
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  }
);

const transferInput = {
  inputs: [
    { internalType: "address", name: "recipient", type: "address" },
    { internalType: "uint256", name: "amount", type: "uint256" },
  ],
  name: "transfer",
  payable: false,
};

const stakeInput = {
  inputs: [
    { internalType: "uint128", name: "amount", type: "uint128" },
    { internalType: "address", name: "votingContract", type: "address" },
  ],
  name: "stake",
  payable: false,
};

const delegateToVoter = {
  inputs: [],
  name: "delegateToVoter",
  payable: false,
};
