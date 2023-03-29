// This script constructs a gnosis safe transaction payload to pull tokens from DesignatedVoting to DesignatedVotingV2
// on behalf of all voters who are delegates owned by the configured owner.

const hre = require("hardhat");
import { utils } from "ethers";
import yesno from "yesno";
import { VotingTokenEthers, DesignatedVotingV2FactoryEthers, DesignatedVotingV2Ethers } from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";
import { baseSafePayload, appendTxToSafePayload } from "../../utils/gnosisPayload";

import { getDesignatedVotingContractsOwnedByOwner } from "./common";

import fs from "fs";
import path from "path";

async function main() {
  console.log("Running Migration Gnosis payload builder 👷‍♀️");
  const chainId = Number(await hre.getChainId());
  if (chainId != 1) throw new Error("Can only run on mainnet");

  if (!process.env.OWNER_TO_MIGRATE) throw new Error("No OWNER_TO_MIGRATE set");
  const owner = process.env.OWNER_TO_MIGRATE || "";

  if (!process.env.GNOSIS_SAFE) throw new Error("No GNOSIS_SAFE set");
  const safe = process.env.GNOSIS_SAFE || "";

  // Step 1: fetch all current DesignatedVoting contracts owned by the owner. Remove elements that have 0 balance.
  const designatedVotingData = (await getDesignatedVotingContractsOwnedByOwner(owner)).filter((e) => e.balance.gt(0));

  // Step 2: fetch all the deployed DesignatedVotingV2 from the canonical factory and append them to this datastructure.
  const factoryV2 = await getContractInstance<DesignatedVotingV2FactoryEthers>("DesignatedVotingV2Factory");

  // Step 3: fetch the newly deployed designated voting contracts and append this to the designated voting data.
  const newDesignatedVotingV2Events = await factoryV2.queryFilter(
    factoryV2.filters.NewDesignatedVoting(null, owner, null)
  );
  const augmentedDesignedVotingData = designatedVotingData.map((data) => {
    return {
      ...data,
      designatedVotingV2: (newDesignatedVotingV2Events as any).filter((event: any) => event.args.voter == data.voter)[0]
        ?.args.designatedVoting as string,
    };
  });

  // Step 4: run a checkup against all the new designated voting contracts to verify that for each element: a) the
  // owner is indeed the migrated owner and b) the voter is set to the correct hot wallet. This ensures that the
  // deployment steps have been done correctly before doing any migrations.
  for (const data of augmentedDesignedVotingData) {
    const designatedVoting = await getContractInstance<DesignatedVotingV2Ethers>(
      "DesignatedVotingV2",
      data.designatedVotingV2
    );
    const [owner, voter] = await Promise.all([designatedVoting.getMember(0), designatedVoting.getMember(1)]);
    if (data.owner != owner)
      throw new Error(`Owner mismatch on ${data.designatedVotingV2}: Expected owner ${data.owner}. Set owner ${owner}`);
    if (data.voter != voter)
      throw new Error(`Voter mismatch on ${data.designatedVotingV2}: Expected voter ${data.owner}. Set voter ${owner}`);
  }

  console.log(`The following augmented designated voting data has been loaded in for the owner owned by ${owner}:`);
  const loggedObject = JSON.parse(JSON.stringify(augmentedDesignedVotingData));
  console.table(
    loggedObject.map((e: any) => {
      delete e.owner;
      const umaBalance = utils.formatEther(e.balance);
      e.balance = umaBalance.substring(0, umaBalance.indexOf("."));
      return e;
    })
  );

  const shouldBuildPayload = await yesno({
    question: "Does this look correct and should we continue to build the payload? (y/n)",
  });

  if (!shouldBuildPayload) process.exit(0);

  console.log("Constructing payload...");

  // Step 5: construct the gnosis payload to submit the migration process for each of the designated voting contracts.
  let payload = baseSafePayload(
    chainId,
    "TokenMigration",
    `Migrates tokens from DesignatedVoting v1 to v2.` + `${augmentedDesignedVotingData.length} recipients migrated`,
    safe
  );
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");
  const erc20Address = votingToken.address;
  for (const data of augmentedDesignedVotingData) {
    const amount = data.balance.toString();
    // 5.1 Create payload to pull tokens from previous designated voting contract.
    payload = appendTxToSafePayload(payload, data.designatedVoting, withdrawInput, { erc20Address, amount });

    // 5.2 Create payload to send tokens to new designated voting contract.
    payload = appendTxToSafePayload(payload, erc20Address, transferInput, {
      recipient: data.designatedVotingV2,
      amount,
    });
  }

  console.log("Payload constructed!\n Verifying...");

  // Step 6: Verify the payload once again. Each voter should have two actions associated with them: a) pulling of their
  // entitled claim from their previous voting contract and b) deposit into their new voting contract.

  // 6.1: Verify that the number of transactions is correct.
  if (payload.transactions.length !== augmentedDesignedVotingData.length * 2) throw new Error("Payload is not valid");

  // 6.2: Verify that each voter has two transactions associated with them and the contents are correct.
  for (const [index, transaction] of payload.transactions.entries()) {
    const isWithdrawTransaction = index % 2 == 0;
    const augmentedDataIndex = Math.floor(index / 2);
    const associatedData = augmentedDesignedVotingData[augmentedDataIndex];

    // 6.2.1: Verify that the first transaction is a withdraw transaction and is structured correctly.

    if (isWithdrawTransaction) {
      if (transaction.to != associatedData.designatedVoting)
        throw new Error(`Withdraw transaction ${index} is not valid`);
      if (transaction.value != "0")
        throw new Error(`Withdraw transaction ${index} is not valid. Non-zero value set, must be zero.`);
      if (transaction.contractMethod != withdrawInput)
        throw new Error(`Withdraw transaction ${index} is using the wrong contract method`);
      if (transaction.contractInputsValues.erc20Address != erc20Address)
        throw new Error(`Withdraw transaction ${index} is using the wrong ERC20`);
      if (transaction.contractInputsValues.amount != associatedData.balance.toString())
        throw new Error(`Withdraw transaction ${index} is using the wrong Amount`);
    }
    // 6.2.1 Verify that the second transaction is a transfer transaction and is structured correctly.
    else {
      if (transaction.to != erc20Address)
        throw new Error(`Transfer transaction ${index} is using the wrong target address`);
      if (transaction.value != "0")
        throw new Error(`Transfer transaction ${index} is not valid. Non-zero value set, must be zero.`);
      if (transaction.contractMethod != transferInput)
        throw new Error(`Transfer transaction ${index} is using the wrong contract method`);
      if (transaction.contractInputsValues.recipient.toLowerCase() != associatedData.designatedVotingV2.toLowerCase())
        throw new Error(`Transfer transaction ${index} is using the wrong recipient`);
      if (transaction.contractInputsValues.amount != associatedData.balance.toString())
        throw new Error(`Transfer transaction ${index} is using the wrong amount`);
    }
  }

  console.log("Payload verified! \n Saving to disk under /out/1_migration_payload.json");

  // Step 7: save json file.
  const savePath = `${path.resolve(__dirname)}/out/1_migration_payload.json`;
  fs.writeFileSync(savePath, JSON.stringify(payload, null, 4));

  console.log("Payload saved!");
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

const withdrawInput = {
  inputs: [
    { internalType: "address", name: "erc20Address", type: "address" },
    { internalType: "uint256", name: "amount", type: "uint256" },
  ],
  name: "withdrawErc20",
  payable: false,
};

const transferInput = {
  inputs: [
    { internalType: "address", name: "recipient", type: "address" },
    { internalType: "uint256", name: "amount", type: "uint256" },
  ],
  name: "transfer",
  payable: false,
};
