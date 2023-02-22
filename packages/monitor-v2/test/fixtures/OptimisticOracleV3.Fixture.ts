import { addGlobalHardhatTestingAddress } from "@uma/common";
import { ExpandedERC20Ethers, OptimisticOracleV3Ethers } from "@uma/contracts-node";
import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";
import { defaultCurrency, defaultLiveness, defaultOptimisticOracleV3Identifier } from "../constants";
import { getContractFactory, hre, Signer } from "../utils";

export interface OptimisticOracleV3Contracts {
  bondToken: ExpandedERC20Ethers;
  optimisticOracleV3: OptimisticOracleV3Ethers;
}

export const optimisticOracleV3Fixture = hre.deployments.createFixture(
  async ({ ethers }): Promise<OptimisticOracleV3Contracts> => {
    return await deployOptimisticOracleV3(ethers);
  }
);

export const deployOptimisticOracleV3 = hre.deployments.createFixture(
  async ({ ethers }): Promise<OptimisticOracleV3Contracts> => {
    // Signer from ethers and hardhat-ethers are not version compatible.
    const [deployer] = (await ethers.getSigners()) as Signer[];

    // This fixture is dependent on the UMA ecosystem fixture. Run it first and grab the output. This is used in the
    // deployments that follows.
    const parentFixture = await umaEcosystemFixture();

    // Deploy default currency for Optimistic Oracle V3.
    const bondToken = (await (await getContractFactory("ExpandedERC20", deployer)).deploy(
      defaultCurrency.name,
      defaultCurrency.symbol,
      defaultCurrency.decimals
    )) as ExpandedERC20Ethers;

    // Sets default currency as approved in the UMA collateralWhitelist.
    await parentFixture.collateralWhitelist.addToWhitelist(bondToken.address);

    // Sets finalFee for default currency.
    await parentFixture.store.setFinalFee(bondToken.address, { rawValue: defaultCurrency.finalFee });

    // Adds default identifier for Optimistic Oracle V3 to the UMA identifierWhitelist.
    await parentFixture.identifierWhitelist.addSupportedIdentifier(defaultOptimisticOracleV3Identifier);

    // Deploy Optimistic Oracle V3 and add it to global hardhatTestingAddresses.
    const optimisticOracleV3 = (await (await getContractFactory("OptimisticOracleV3", deployer)).deploy(
      parentFixture.finder.address,
      bondToken.address,
      defaultLiveness
    )) as OptimisticOracleV3Ethers;
    addGlobalHardhatTestingAddress("OptimisticOracleV3", optimisticOracleV3.address);

    return { bondToken, optimisticOracleV3 };
  }
);
