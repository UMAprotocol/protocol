// This script initializes Polygon root contracts on mainnet to point to their child counterparts on Polygon if needed.
// Make sure that the newly deployed tunnel contracts have been added to the networks config in the `core` package and
// the `contracts-node` package has been rebuilt.
// Export following environment variables:
// - MNEMONIC: Mnemonic for the operator to initialize root tunnel contracts.
// - NODE_URL_1: Mainnet node URL (not required when using localhost for a forked network).
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/0_InitPolygonRootTunnels.ts --network <network>
// Note: use localhost for the forked network, for mainnet also need to export NODE_URL_1 environment variable.

import { getMnemonicSigner } from "@uma/common";
import { getAddress, FxBaseRootTunnelEthers } from "@uma/contracts-node";
import { Signer, constants as ethersConstants } from "ethers";
import hre from "hardhat";
import { networksNumber } from "../common";
import { getContractInstance } from "../../utils/contracts";

async function main() {
  const signer = getMnemonicSigner().connect(hre.ethers.provider);

  const l2ChainId = networksNumber["polygon"];
  const oracleChildTunnelAddress = await getAddress("OracleChildTunnel", l2ChainId);
  const governorChildTunnelAddress = await getAddress("GovernorChildTunnel", l2ChainId);

  const oracleRootTunnel = await getContractInstance<FxBaseRootTunnelEthers>("OracleRootTunnel");
  const governorRootTunnel = await getContractInstance<FxBaseRootTunnelEthers>("GovernorRootTunnel");

  await initRootTunnel(oracleRootTunnel, oracleChildTunnelAddress, signer);
  await initRootTunnel(governorRootTunnel, governorChildTunnelAddress, signer);
}

async function initRootTunnel(rootTunnel: FxBaseRootTunnelEthers, fxChildTunnelAddress: string, signer: Signer) {
  const currentFxChildTunnelAddress = await rootTunnel.fxChildTunnel();
  if (currentFxChildTunnelAddress === ethersConstants.AddressZero) {
    process.stdout.write(`Initializing fxChildTunnel on ${rootTunnel.address} to ${fxChildTunnelAddress}...`);
    const tx = await rootTunnel.connect(signer).setFxChildTunnel(fxChildTunnelAddress);
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(
      `Initializing fxChildTunnel on ${rootTunnel.address} to ${fxChildTunnelAddress} txn: ${tx.hash}...`
    );
    await tx.wait();
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(
      `Initialized fxChildTunnel on ${rootTunnel.address} to ${fxChildTunnelAddress} txn: ${tx.hash}\n`
    );
  } else {
    console.log(`fxChildTunnel on ${rootTunnel.address} already initialized to ${currentFxChildTunnelAddress}`);
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
