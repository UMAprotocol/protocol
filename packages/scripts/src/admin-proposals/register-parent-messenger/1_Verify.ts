// This script verify that the upgrade was executed correctly.
// Export following environment variable:
// - PARENT_MESSENGER_NAME: Contract name for the parent messenger on mainnet (e.g. Blast_ParentMessenger)
// - TARGET_CHAIN_ID: Chain ID for target L2 network.
// Then run the script with:
// yarn hardhat run packages/scripts/src/admin-proposals/register-parent-messenger/1_Verify.ts --network localhost

import { strict as assert } from "assert";

import { GovernorHubEthers, OracleHubEthers } from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";
import { getAddress } from "../../upgrade-tests/register-new-contract/common";

async function main() {
  const targetChainId = Number(process.env.TARGET_CHAIN_ID);
  if (!Number.isInteger(targetChainId)) throw new Error("Missing or invalid TARGET_CHAIN_ID env");

  const parentMessengerName = process.env.PARENT_MESSENGER_NAME;
  if (parentMessengerName === undefined) throw new Error("Missing PARENT_MESSENGER_NAME env");

  const parentMessengerAddress = await getAddress(parentMessengerName, 1);

  const oracleHub = await getContractInstance<OracleHubEthers>("OracleHub");
  const governorHub = await getContractInstance<GovernorHubEthers>("GovernorHub");

  console.log(` 1. Validating parent messenger on OracleHub`);
  assert((await oracleHub.messengers(targetChainId)) === parentMessengerAddress, "Parent messenger not set");
  console.log(`✅ Parent Messenger for chain ${targetChainId} is set to ${parentMessengerAddress} on OracleHub`);

  console.log(` 2. Validating parent messenger on GovernorHub`);
  assert((await governorHub.messengers(targetChainId)) === parentMessengerAddress, "Parent messenger not set");
  console.log(`✅ Parent Messenger for chain ${targetChainId} is set to ${parentMessengerAddress} on GovernorHub`);
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
