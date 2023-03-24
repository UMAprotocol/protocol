// This script is the final step in the migration of the designated voting contracts in which the owner (delegator) needs
// to call a) stake and b) delegateToVoter on the new DesignatedVotingV2 contracts. This script will construct a gnosis
// safe payload to do this on behalf of the owner.

const hre = require("hardhat");

import {
  VotingTokenEthers,
  DesignatedVotingV2FactoryEthers,
  VotingV2Ethers,
  DesignatedVotingV2Ethers,
} from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";
import { baseSafePayload, appendTxToSafePayload } from "../../utils/gnosisPayload";
import { utils } from "ethers";

import fs from "fs";
import path from "path";

async function main() {
  console.log("Running Stake and Delegate to Voter Gnosis payload builder 👷‍♀️");
  const chainId = Number(await hre.getChainId());
  if (chainId != 1) throw new Error("Can only run on mainnet");

  if (!process.env.OWNER_TO_MIGRATE) throw new Error("No OWNER_TO_MIGRATE set");
  const owner = process.env.OWNER_TO_MIGRATE || "";

  if (!process.env.GNOSIS_SAFE) throw new Error("No GNOSIS_SAFE set");
  const safe = process.env.GNOSIS_SAFE || "";

  // Replace hot wallets based on provided env variable.
  // Note: the env variable should be formatted as follows:
  // HOT_WALLET_REPLACEMENTS="0x1234:0x5678,0x9abc:0xdef0"
  const replacementPairs = process.env.HOT_WALLET_REPLACEMENTS?.split(",") || [];
  const oldToNewHotWallet = Object.fromEntries(
    replacementPairs.map((replacementPair) => {
      // Split by ":".
      const [originalWallet, replacementWallet] = replacementPair.split(":");
      if (!originalWallet || !replacementWallet) throw new Error("Invalid HOT_WALLET_REPLACEMENTS provided");
      // Ensure that the addresses are formatted consistently.
      return [utils.getAddress(originalWallet), utils.getAddress(replacementWallet)];
    })
  );

  // Step 1: fetch all the deployed DesignatedVotingV2 deployed from the factory.
  const factoryV2 = await getContractInstance<DesignatedVotingV2FactoryEthers>("DesignatedVotingV2Factory");
  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2");

  // Step 2: fetch the newly deployed designated voting contracts and append this to the designated voting data.
  const newDesignatedVotingV2Events = await factoryV2.queryFilter(
    factoryV2.filters.NewDesignatedVoting(null, owner, null)
  );
  const designatedVotingContracts = newDesignatedVotingV2Events.map((data) => data.args.designatedVoting);

  // Step 3: For each Designated construct the associated payload to stake and delegate to voter.
  let payload = baseSafePayload(
    chainId,
    "StakeAndDelegateToVoter",
    `Once tokens have been deposited into the DesignatedVotingV2 and the governance migration has concluded, we can ` +
      `stake and delegate to the voter. This payload does this for all DesignatedVotingV2 contracts owned by the owner.`,
    safe
  );
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");
  for (const designatedVoting of designatedVotingContracts) {
    const amount = await votingToken.balanceOf(designatedVoting);
    const dvContract = await getContractInstance<DesignatedVotingV2Ethers>("DesignatedVotingV2", designatedVoting);
    const currentVoter = utils.getAddress(await dvContract.getMember(1));
    const updatedHotWallet = oldToNewHotWallet[currentVoter];
    if (amount.isZero()) {
      console.log("Skipping", currentVoter, "as it has no tokens to stake");
      continue;
    }
    if (updatedHotWallet) {
      console.log("Updating voter", currentVoter, "to", updatedHotWallet, "for", designatedVoting);
      payload = appendTxToSafePayload(payload, designatedVoting, updateVoter, {
        roleId: "1",
        newMember: updatedHotWallet,
      });
    }
    payload = appendTxToSafePayload(payload, designatedVoting, stakeInput, {
      amount: amount.toString(),
      votingContract: votingV2.address,
    });
    payload = appendTxToSafePayload(payload, designatedVoting, delegateToVoter, {});
  }

  // Step 4: save json file.
  const savePath = `${path.resolve(__dirname)}/out/2_delegate_payload.json`;
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

const updateVoter = {
  inputs: [
    { internalType: "uint256", name: "roleId", type: "uint256" },
    { internalType: "address", name: "newMember", type: "address" },
  ],
  name: "resetMember",
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
