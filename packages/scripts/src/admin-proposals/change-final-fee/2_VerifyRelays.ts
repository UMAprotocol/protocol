// This script verifies that the new final fee has been correctly configured in layer 2 chains.
// It can be run on forks directly on the mainnets to verify.
// This script needs the PROPOSAL_DATA logged by  ./src/admin-proposals/change-final-fee/1_Propose.ts
// Additionally, this script needs the NODE_URLs for each layer 2 chain to verify the relays.
// Finally set FORK_NETWORK to true to fork each network and simulate the relays.
// Then execute the script:
// FORK_NETWORK=true \ => optional
// NEW_FINAL_FEE_USD=<NEW_FINAL_FEE_USD> \
// NEW_FINAL_FEE_WETH=<NEW_FINAL_FEE_WETH> \
// NODE_URL_10=<OPTIMISM-NODE-URL> \
// NODE_URL_137=<POLYGON-NODE-URL> \
// NODE_URL_42161=<ARBITRUM-NODE-URL> \
// PROPOSAL_DATA=<PROPOSAL_DATA> \
// yarn hardhat run ./src/admin-proposals/change-final-fee/2_VerifyRelays.ts

import { Provider } from "@ethersproject/abstract-provider";
import { getRetryProvider } from "@uma/common";
import { ERC20Ethers, StoreEthers } from "@uma/contracts-node";
import { getContractInstanceWithProvider } from "../../utils/contracts";
import {
  GovernorChildTunnelEthers,
  GovernorSpokeEthers,
  ParamType,
  Signer,
  assert,
  decodeRelayMessages,
  forkNetwork,
  getAddress,
  getContractInstance,
  hre,
  tokensToUpdateFee,
} from "./common";

async function main() {
  const shouldForkNetwork = process.env.FORK_NETWORK === "true";
  const callData = process.env["PROPOSAL_DATA"];
  if (!callData) throw new Error("PROPOSAL_DATA environment variable not set");

  if (!process.env.NEW_FINAL_FEE_USD) throw new Error("NEW_FINAL_FEE_USD is not set");
  if (!process.env.NEW_FINAL_FEE_WETH) throw new Error("NEW_FINAL_FEE_WETH is not set");

  const newFinalFeeUSD = Number(process.env.NEW_FINAL_FEE_USD);
  const newFinalFeeWeth = Number(process.env.NEW_FINAL_FEE_WETH);

  const { governorRootRelays, governorHubRelays } = decodeRelayMessages(callData);

  const l2NetworksNumber = { polygon: 137, optimism: 10, arbitrum: 42161 };

  for (const [networkName, networkId] of Object.entries(l2NetworksNumber)) {
    const l2NodeUrl = process.env[String("NODE_URL_" + networkId)];

    if (!l2NodeUrl) throw new Error("NODE_URL_" + networkId + " environment variable not set");

    if (shouldForkNetwork) await forkNetwork(l2NodeUrl, undefined);

    const store = await getContractInstance<StoreEthers>("Store", undefined, networkId);

    if (networkName === "polygon") {
      const governorChildTunnel = await getContractInstance<GovernorChildTunnelEthers>(
        "GovernorChildTunnel",
        undefined,
        networkId
      );

      if (shouldForkNetwork) {
        const fxChild = "0x8397259c983751DAf40400790063935a11afa28a";
        const fxRootTunnel = "0x4f490f4835b3693a8874aee87d7cc242c25dccaf";
        await hre.network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [fxChild],
        });

        await hre.network.provider.send("hardhat_setBalance", [
          fxChild,
          hre.ethers.utils.parseEther("10.0").toHexString(),
        ]);

        for (const relay of governorRootRelays) {
          const calldata: string = hre.ethers.utils.defaultAbiCoder.encode(
            ["address", "bytes"],
            [relay.transaction.params.to, relay.transaction.params.data]
          );
          await governorChildTunnel
            .connect(hre.ethers.provider.getSigner(fxChild) as Signer)
            .processMessageFromRoot(0, fxRootTunnel, calldata);
        }
      }
    } else {
      const governorSpoke = await getContractInstance<GovernorSpokeEthers>("GovernorSpoke", undefined, networkId);

      if (shouldForkNetwork) {
        const networkNameFirstCapitalLetter = networkName.charAt(0).toUpperCase() + networkName.slice(1);
        const messenger = await getAddress(`${networkNameFirstCapitalLetter}_ChildMessenger`, Number(networkId));
        await hre.network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [messenger],
        });

        await hre.network.provider.send("hardhat_setBalance", [
          messenger,
          hre.ethers.utils.parseEther("10.0").toHexString(),
        ]);

        const governorHubRelaysForNetwork = governorHubRelays.find(
          (relay) => Number(relay.transaction.params.chainId) === networkId
        );

        if (!governorHubRelaysForNetwork) throw new Error("No governorHubRelays found for network " + networkName);

        const callData: string = hre.ethers.utils.defaultAbiCoder.encode(
          [
            {
              type: "tuple[]",
              components: [
                { name: "to", type: "address" },
                { name: "data", type: "bytes" },
              ],
            } as ParamType,
          ],
          [governorHubRelaysForNetwork.transaction.params.calls]
        );
        await governorSpoke
          .connect(hre.ethers.provider.getSigner(messenger) as Signer)
          .processMessageFromParent(callData);
      }
    }

    for (const tokenName of Object.keys(tokensToUpdateFee)) {
      const tokens = tokensToUpdateFee[tokenName as keyof typeof tokensToUpdateFee];
      const tokenAddress = tokens[networkName as keyof typeof tokens];
      const provider = getRetryProvider(networkId) as Provider;
      const erc20 = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, tokenAddress);
      const decimals = await erc20.decimals();
      const isWeth = tokenName == "WETH";
      const newFinalFee = isWeth ? newFinalFeeWeth : newFinalFeeUSD;

      console.log(`Verifying ${tokenName} final fee ${networkName}...`);
      assert((await store.finalFees(tokenAddress)).eq(hre.ethers.utils.parseUnits(newFinalFee.toString(), decimals)));
      console.log("Verified!");
    }
  }

  console.log("Upgrade Verified!");
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
