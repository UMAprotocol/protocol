import { addGlobalHardhatTestingAddress } from "@uma/common";
import { ExpandedERC20Ethers } from "@uma/contracts-node";
import type { OptimisticOracleEthers } from "@uma/contracts-node";
import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";
import { defaultCurrency, defaultLiveness, defaultOptimisticOracleV2Identifier } from "../constants";
import { getContractFactory, hre, Signer } from "../utils";

// Re-export a local alias to keep existing imports stable in tests
export type OptimisticOracleV1Ethers = OptimisticOracleEthers;

export interface OptimisticOracleV1Contracts {
  bondToken: ExpandedERC20Ethers;
  optimisticOracleV1: OptimisticOracleV1Ethers;
}

export const optimisticOracleV1Fixture = hre.deployments.createFixture(
  async ({ ethers }): Promise<OptimisticOracleV1Contracts> => {
    return await deployOptimisticOracleV1(ethers);
  }
);

export const deployOptimisticOracleV1 = hre.deployments.createFixture(
  async ({ ethers }): Promise<OptimisticOracleV1Contracts> => {
    // Signer from ethers and hardhat-ethers are not version compatible.
    const [deployer] = (await ethers.getSigners()) as Signer[];

    // This fixture is dependent on the UMA ecosystem fixture. Run it first and grab the output.
    const parentFixture = await umaEcosystemFixture();

    // Deploy default currency for Optimistic Oracle V1.
    const bondToken = (await (await getContractFactory("ExpandedERC20", deployer)).deploy(
      defaultCurrency.name,
      defaultCurrency.symbol,
      defaultCurrency.decimals
    )) as ExpandedERC20Ethers;

    // Sets default currency as approved in the UMA collateralWhitelist.
    await parentFixture.collateralWhitelist.addToWhitelist(bondToken.address);

    // Sets finalFee for default currency.
    await parentFixture.store.setFinalFee(bondToken.address, { rawValue: defaultCurrency.finalFee });

    // Adds default identifier for Optimistic Oracle V1 to the UMA identifierWhitelist.
    await parentFixture.identifierWhitelist.addSupportedIdentifier(defaultOptimisticOracleV2Identifier);

    // Deploy Optimistic Oracle V1
    const OptimisticOracleV1Factory = await getContractFactory("OptimisticOracle", deployer);

    const optimisticOracleV1 = (await OptimisticOracleV1Factory.deploy(
      defaultLiveness,
      parentFixture.finder.address,
      parentFixture.timer.address
    )) as OptimisticOracleV1Ethers;

    addGlobalHardhatTestingAddress("OptimisticOracle", optimisticOracleV1.address);

    return { bondToken, optimisticOracleV1 };
  }
);
