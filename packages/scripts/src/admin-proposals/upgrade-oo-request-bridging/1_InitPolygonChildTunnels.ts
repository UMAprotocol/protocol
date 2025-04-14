// This script initializes Polygon child contracts on Polygon to point to their root counterparts on mainnet if needed.
// Make sure that the newly deployed tunnel contracts have been added to the networks config in the `core` package and
// the `contracts-node` package has been rebuilt.
// Export following environment variables:
// - MNEMONIC: Mnemonic for the operator to initialize root tunnel contracts.
// - NODE_URL_137: Mainnet node URL or its forking endpoint (e.g. http://localhost:9546).
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/1_InitPolygonChildTunnels.ts --network matic
// Note that we don't use localhost for the forked network, instead just pass the fork endpoint to NODE_URL_137.

import { getMnemonicSigner } from "@uma/common";
import { getAddress, FxBaseChildTunnelEthers } from "@uma/contracts-node";
import { Signer, constants as ethersConstants } from "ethers";
import hre from "hardhat";
import { networksNumber } from "../common";
import { getContractInstance } from "../../utils/contracts";

async function main() {
  const signer = getMnemonicSigner().connect(hre.ethers.provider);

  const l1ChainId = networksNumber["mainnet"];
  const oracleRootTunnelAddress = await getAddress("OracleRootTunnel", l1ChainId);
  const governorRootTunnelAddress = await getAddress("GovernorRootTunnel", l1ChainId);

  const oracleChildTunnel = await getContractInstance<FxBaseChildTunnelEthers>("OracleChildTunnel");
  const governorChildTunnel = await getContractInstance<FxBaseChildTunnelEthers>("GovernorChildTunnel");

  await initChildTunnel(oracleChildTunnel, oracleRootTunnelAddress, signer);
  await initChildTunnel(governorChildTunnel, governorRootTunnelAddress, signer);
}

async function initChildTunnel(childTunnel: FxBaseChildTunnelEthers, fxRootTunnelAddress: string, signer: Signer) {
  const currentFxRootTunnelAddress = await childTunnel.fxRootTunnel();
  if (currentFxRootTunnelAddress === ethersConstants.AddressZero) {
    process.stdout.write(`Initializing fxRootTunnel on ${childTunnel.address} to ${fxRootTunnelAddress}...`);
    const tx = await childTunnel.connect(signer).setFxRootTunnel(fxRootTunnelAddress);
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(
      `Initializing fxRootTunnel on ${childTunnel.address} to ${fxRootTunnelAddress} txn: ${tx.hash}...`
    );
    await tx.wait();
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(
      `Initialized fxRootTunnel on ${childTunnel.address} to ${fxRootTunnelAddress} txn: ${tx.hash}\n`
    );
  } else {
    console.log(`fxRootTunnel on ${childTunnel.address} already initialized to ${currentFxRootTunnelAddress}`);
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
