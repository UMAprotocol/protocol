// This script verify that the upgrade was executed correctly.
// yarn hardhat run packages/scripts/src/admin-proposals/register-parent-messenger-and-gas-limit/1_Verify.ts --network localhost

import { strict as assert } from "assert";

import { GovernorHubEthers, OracleHubEthers, getAddress } from "@uma/contracts-node";
import { OptimismParentMessenger } from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../../utils/contracts";
import { PARENT_MESSENGER_DEFAULT_GAS_LIMIT } from "./common";

async function main() {
  const baseChainId = 8453;
  const newGasLimit = PARENT_MESSENGER_DEFAULT_GAS_LIMIT;

  const baseParentMessengerAddress = await getAddress("Base_ParentMessenger", 1);

  const oracleHub = await getContractInstance<OracleHubEthers>("OracleHub");
  const governorHub = await getContractInstance<GovernorHubEthers>("GovernorHub");
  const optimismParentMessenger = await getContractInstance<OptimismParentMessenger>("Optimism_ParentMessenger");
  const baseParentMessenger = await getContractInstance<OptimismParentMessenger>(
    "Optimism_ParentMessenger",
    baseParentMessengerAddress
  );

  console.log(` 1. Validating base parent messenger on OracleHub`);
  assert((await oracleHub.messengers(baseChainId)) === baseParentMessengerAddress, "Parent messenger not set");
  console.log(`✅ Base Parent Messenger is set to ${baseParentMessengerAddress} on OracleHub`);

  console.log(` 2. Validating base parent messenger on GovernorHub`);
  assert((await governorHub.messengers(baseChainId)) === baseParentMessengerAddress, "Parent messenger not set");
  console.log(`✅ Base Parent Messenger is set to ${baseParentMessengerAddress} on GovernorHub`);

  console.log(` 3. Validating default gas limit on OptimismParentMessenger`);
  const defaultGasLimit = await optimismParentMessenger.defaultGasLimit();
  assert(defaultGasLimit === newGasLimit, "Default gas limit not set");
  console.log(`✅ Default gas limit is set to ${newGasLimit} on OptimismParentMessenger`);

  console.log(` 4. Validating default gas limit on Base Parent Messenger`);
  const baseParentMessengerGasLimit = await baseParentMessenger.defaultGasLimit();
  assert(baseParentMessengerGasLimit === newGasLimit, "Default gas limit not set");
  console.log(`✅ Default gas limit is set to ${newGasLimit} on Base Parent Messenger`);
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
