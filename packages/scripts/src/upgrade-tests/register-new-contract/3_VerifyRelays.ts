// This script verifies that the new contract has been added correctly to the Registry and Finder in layer 2 chains.
// It can be run on forks directly on the mainnets to verify.
// This script needs the PROPOSAL_DATA logged by  ./src/upgrade-tests/register-new-contract/1_Propose.ts
// Additionally, this script needs the NODE_URLs for each layer 2 chain to verify the relays.
// Finally set FORK_NETWORK to true to fork each network and simulate the relays.
// Then execute the script:
// FORK_NETWORK=true \ => optional
// NODE_URL_10=<OPTIMISM-NODE-URL> \
// NODE_URL_288=<BOBA-NODE-URL> \
// NODE_URL_137=<POLYGON-NODE-URL> \
// NODE_URL_42161=<ARBITRUM-NODE-URL> \
// PROPOSAL_DATA=<PROPOSAL_DATA> \
// yarn hardhat run ./src/upgrade-tests/register-new-contract/3_VerifyRelays.ts

import {
  assert,
  decodeRelayMessages,
  FinderEthers,
  forkNetwork,
  getAddress,
  getContractInstance,
  GovernorChildTunnelEthers,
  GovernorSpokeEthers,
  hre,
  newContractName,
  OptimisticOracleV3Ethers,
  ParamType,
  RegistryEthers,
  RegistryRolesEnum,
  Signer,
} from "./common";

async function main() {
  const shouldForkNetwork = process.env.FORK_NETWORK === "true";
  const callData = process.env["PROPOSAL_DATA"];
  if (!callData) throw new Error("PROPOSAL_DATA environment variable not set");

  const { governorRootRelays, governorHubRelays } = decodeRelayMessages(callData);

  const l2Networks = { Boba: 288, Matic: 137, Optimism: 10, Arbitrum: 42161 };

  for (const [networkName, networkId] of Object.entries(l2Networks)) {
    const l2NodeUrl = process.env[String("NODE_URL_" + networkId)];

    if (!l2NodeUrl) throw new Error("NODE_URL_" + networkId + " environment variable not set");

    if (shouldForkNetwork) await forkNetwork(l2NodeUrl, undefined);

    const finder = await getContractInstance<FinderEthers>("Finder", undefined, networkId);
    const registry = await getContractInstance<RegistryEthers>("Registry", undefined, networkId);
    const newContractToVerify = await getContractInstance<OptimisticOracleV3Ethers>(
      newContractName,
      undefined,
      networkId
    );

    let governorAddress;
    if (networkName === "Matic") {
      const governorChildTunnel = await getContractInstance<GovernorChildTunnelEthers>(
        "GovernorChildTunnel",
        undefined,
        networkId
      );
      governorAddress = governorChildTunnel.address;
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
      governorAddress = governorSpoke.address;

      if (shouldForkNetwork) {
        const messenger = await getAddress(`${networkName}_ChildMessenger`, Number(networkId));
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

    console.log(`[${networkName}] Verifying that Governor doesn't hold the creator role...`);
    !(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, governorAddress));
    console.log("Verified!");

    console.log(`[${networkName}] Verifying that the New Contract is registered with the Registry...`);
    assert(await registry.isContractRegistered(newContractToVerify.address));
    console.log("Verified!");

    console.log(`[${networkName}] that the New Contract is registered with the Finder...`);
    assert.equal(
      (await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(newContractName))).toLowerCase(),
      newContractToVerify.address.toLowerCase()
    );
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
