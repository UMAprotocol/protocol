import { OracleHubEthers } from "@uma/contracts-frontend";
import {
  FxChildMockEthers,
  FxRootMockEthers,
  OracleMessengerMockEthers,
  OracleRootTunnelEthers,
  StateSyncMockEthers,
} from "@uma/contracts-node";
import { getContractFactory, hre, Signer } from "../utils";
import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";

export interface DVM2Contracts {
  oracleHub: OracleHubEthers;
  oracleRootTunnel: OracleRootTunnelEthers;
  messengerMock: OracleMessengerMockEthers;
}

export const oracleCrossChainFixture = hre.deployments.createFixture(
  async ({ ethers }): Promise<DVM2Contracts> => {
    return await deployOracleCrossChain(ethers);
  }
);

export const deployOracleCrossChain = hre.deployments.createFixture(
  async ({ ethers }): Promise<DVM2Contracts> => {
    // Signer from ethers and hardhat-ethers are not version compatible.
    const [deployer] = (await ethers.getSigners()) as Signer[];

    // This fixture is dependent on the UMA ecosystem fixture. Run it first and grab the output. This is used in the
    // deployments that follows.
    const parentFixture = await umaEcosystemFixture();

    const oracleHub = (await (await getContractFactory("OracleHub", deployer)).deploy(
      parentFixture.finder.address,
      parentFixture.votingToken.address
    )) as OracleHubEthers;

    const stateSync = (await (await getContractFactory("StateSyncMock", deployer)).deploy()) as StateSyncMockEthers;
    const fxRoot = (await (await getContractFactory("FxRootMock", deployer)).deploy(
      stateSync.address
    )) as FxRootMockEthers;
    const fxChild = (await (await getContractFactory("FxChildMock", deployer)).deploy(
      await deployer.getAddress()
    )) as FxChildMockEthers;

    await (await fxChild.setFxRoot(fxRoot.address)).wait();
    await (await fxRoot.setFxChild(fxChild.address)).wait();

    const oracleRootTunnel = (await (await getContractFactory("OracleRootTunnel", deployer)).deploy(
      await deployer.getAddress(),
      fxRoot.address,
      parentFixture.finder.address
    )) as OracleRootTunnelEthers;

    const messengerMock = (await (
      await getContractFactory("OracleMessengerMock", deployer)
    ).deploy()) as OracleMessengerMockEthers;

    // Add contracts to global hardhatTestingAddresses.
    // addGlobalHardhatTestingAddress("VotingV2", votingV2.address);
    // addGlobalHardhatTestingAddress("GovernorV2", governorV2.address);
    // addGlobalHardhatTestingAddress("ProposerV2", proposerV2.address);
    // addGlobalHardhatTestingAddress("EmergencyProposer", emergencyProposer.address);

    return { oracleHub, oracleRootTunnel, messengerMock };
  }
);
