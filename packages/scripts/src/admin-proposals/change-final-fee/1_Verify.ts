// This script verifies that the new final fee has been correctly configured in  in mainnet.
// It can be run on a local hardhat node fork of the mainnet or can be run directly on the mainnet to verify.
// To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script from core with the PROPOSAL_DATA logged by  ./src/admin-proposals/change-final-fee/0_Propose.ts:
// NODE_URL_1=<MAINNET-NODE-URL> \
// TOKENS_TO_UPDATE='{"USDC":{"finalFee":"250.00","mainnet":"0x123","polygon":"0x123","arbitrum":"0x123"}}' \
// yarn hardhat run ./src/admin-proposals/change-final-fee/1_Verify.ts --network localhost

import { AddressWhitelistEthers, ERC20Ethers, StoreEthers } from "@uma/contracts-node";
import { Provider, assert, getContractInstance, parseAndValidateTokensConfig } from "./common";
import { getRetryProvider } from "@uma/common";
import { getContractInstanceWithProvider } from "../../utils/contracts";

async function main() {
  const store = await getContractInstance<StoreEthers>("Store");
  const addressWhitelist = await getContractInstance<AddressWhitelistEthers>("AddressWhitelist");

  const tokensToUpdate = parseAndValidateTokensConfig(process.env.TOKENS_TO_UPDATE);

  for (const [token, updateInfo] of Object.entries(tokensToUpdate)) {
    const tokenAddress = updateInfo["mainnet"];
    if (!tokenAddress) continue;
    const newFinalFee = updateInfo["finalFee"];
    const provider = getRetryProvider(1) as Provider;
    const erc20 = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, tokenAddress);
    const decimals = await erc20.decimals();

    console.log(`Verifying ${token} in whitelist on mainnet...`);
    assert(await addressWhitelist.isOnWhitelist(tokenAddress));
    console.log("Verified!");

    console.log(`Verifying ${token} final fee on mainnet...`);
    assert((await store.finalFees(tokenAddress)).eq(hre.ethers.utils.parseUnits(newFinalFee.toString(), decimals)));
    console.log("Verified!");

    console.log("Upgrade Verified!");
  }
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
