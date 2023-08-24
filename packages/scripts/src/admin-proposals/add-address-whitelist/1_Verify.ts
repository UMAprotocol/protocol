// This script verify that the upgrade was executed correctly.
// ADDRESS=<ADDRESS-TO-ADD> \
// FINAL_FEE=<FINAL_FEE> \
// yarn hardhat run ./src/admin-proposals/add-address-whitelist/1_Verify.ts --network localhost

import { strict as assert } from "assert";

import { AddressWhitelistEthers, ERC20Ethers, StoreEthers } from "@uma/contracts-node";
import { getContractInstance, getContractInstanceWithProvider } from "../../utils/contracts";
import { getRetryProvider } from "@uma/common";
import { Provider } from "@ethersproject/abstract-provider";

async function main() {
  const addressWhitelist = await getContractInstance<AddressWhitelistEthers>("AddressWhitelist");
  const store = await getContractInstance<StoreEthers>("Store");

  if (!process.env.ADDRESS) throw new Error("ADDRESS is not set");
  const newAddress = process.env.ADDRESS;

  if (!process.env.FINAL_FEE) throw new Error("FINAL_FEE is not set");
  const finalFee = Number(process.env.FINAL_FEE);

  const provider = getRetryProvider(1) as Provider;
  const erc20 = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, newAddress);
  const decimals = await erc20.decimals();

  console.log(` 1. Validating address ${process.env.ADDRESS} is whitelisted`);
  assert(await addressWhitelist.isOnWhitelist(newAddress));
  console.log(`✅ ${process.env.ADDRESS} address is whitelisted`);

  console.log(` 2. Validating final fee is ${finalFee}`);
  assert((await store.finalFees(newAddress)).eq(hre.ethers.utils.parseUnits(finalFee.toString(), decimals)));
  console.log(`✅ Final fee is ${finalFee}`);
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
