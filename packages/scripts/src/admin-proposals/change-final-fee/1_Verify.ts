// This script verifies that the new final fee has been correctly configured in  in mainnet.
// It can be run on a local hardhat node fork of the mainnet or can be run directly on the mainnet to verify.
// To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script from core with the PROPOSAL_DATA logged by  ./src/admin-proposals/change-final-fee/0_Propose.ts:
// NEW_FINAL_FEE_USD=<NEW_FINAL_FEE_USD> \
// NEW_FINAL_FEE_WETH=<NEW_FINAL_FEE_WETH> \
// NODE_URL_1=<MAINNET-NODE-URL> \
// PROPOSAL_DATA=<PROPOSAL_DATA> \
// yarn hardhat run ./src/admin-proposals/change-final-fee/1_Verify.ts --network localhost

import { ERC20Ethers, StoreEthers } from "@uma/contracts-node";
import { Provider, assert, getContractInstance } from "./common";
import { tokensToUpdateFee } from "./common";
import { getRetryProvider } from "@uma/common";
import { getContractInstanceWithProvider } from "../../utils/contracts";

async function main() {
  const callData = process.env["PROPOSAL_DATA"];
  if (!callData) throw new Error("PROPOSAL_DATA environment variable not set");
  if (!process.env.NEW_FINAL_FEE_USD) throw new Error("NEW_FINAL_FEE_USD is not set");
  if (!process.env.NEW_FINAL_FEE_WETH) throw new Error("NEW_FINAL_FEE_WETH is not set");

  const newFinalFeeUSD = Number(process.env.NEW_FINAL_FEE_USD);
  const newFinalFeeWeth = Number(process.env.NEW_FINAL_FEE_WETH);

  const store = await getContractInstance<StoreEthers>("Store");

  for (const tokenName of Object.keys(tokensToUpdateFee)) {
    const tokenAddress = tokensToUpdateFee[tokenName as keyof typeof tokensToUpdateFee]["mainnet"];
    const provider = getRetryProvider(1) as Provider;
    const erc20 = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, tokenAddress);
    const decimals = await erc20.decimals();
    const isWeth = tokenName == "WETH";
    const newFinalFee = isWeth ? newFinalFeeWeth : newFinalFeeUSD;

    console.log(`Verifying ${tokenName} final fee...`);
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
