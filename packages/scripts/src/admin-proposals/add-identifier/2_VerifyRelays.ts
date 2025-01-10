// This script verify that the indentifier has been whitelisted in the IdentifierWhitelist contract in layer 2 chains.
// It can be run on forks directly on the mainnets to verify.
// This script needs the PROPOSAL_DATA logged by  packages/scripts/src/admin-proposals/add-identifier/0_Propose.ts
// Additionally, this script needs the NODE_URLs for each layer 2 chain to verify the relays.
// Finally set FORK_NETWORK to true to fork each network and simulate the relays.
// Then execute the script:
// FORK_NETWORK=true \ => optional
// NODE_URL_10=<OPTIMISM-NODE-URL> \
// NODE_URL_137=<POLYGON-NODE-URL> \
// NODE_URL_8453=<BASE-NODE-URL> \
// NODE_URL_42161=<ARBITRUM-NODE-URL> \
// NODE_URL_81457=<BLAST-NODE-URL> \
// PROPOSAL_DATA=<PROPOSAL_DATA> \
// yarn hardhat run ./packages/scripts/src/admin-proposals/add-identifier/2_VerifyRelays.ts

import { IdentifierWhitelistEthers } from "@uma/contracts-node";
import { formatBytes32String } from "ethers/lib/utils";
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
  isSupportedNetwork,
  networksNumber,
} from "./common";

async function main() {
  const shouldForkNetwork = process.env.FORK_NETWORK === "true";
  const callData = process.env["PROPOSAL_DATA"];
  if (!callData) throw new Error("PROPOSAL_DATA environment variable not set");

  if (!process.env.IDENTIFIER) throw new Error("IDENTIFIER is not set");
  const newIdentifier = formatBytes32String(process.env.IDENTIFIER);

  const { governorRootRelays, governorHubRelays } = decodeRelayMessages(callData);

  const l2s = (({ mainnet, ...others }) => others)(networksNumber);
  for (const [networkName, networkId] of Object.entries(l2s)) {
    if (!isSupportedNetwork(networkName)) throw new Error(`Unsupported network: ${networkName}`);
    const l2NodeUrl = process.env[String("NODE_URL_" + networkId)];

    if (!l2NodeUrl) throw new Error("NODE_URL_" + networkId + " environment variable not set");

    if (shouldForkNetwork) await forkNetwork(l2NodeUrl, undefined);

    const identifierWhitelist = await getContractInstance<IdentifierWhitelistEthers>(
      "IdentifierWhitelist",
      undefined,
      networkId
    );

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

    console.log(`Validating identifier ${process.env.IDENTIFIER} ${networkName}...`);
    assert(await identifierWhitelist.isIdentifierSupported(newIdentifier));
    console.log("Verified!");
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
