import { addGlobalHardhatTestingAddress } from "@uma/common";
import { ExpandedERC20Ethers, OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";
import { defaultCurrency, defaultLiveness, defaultOptimisticOracleV2Identifier } from "../constants";
import { getContractFactory, hre, Signer } from "../utils";

export interface OptimisticOracleV2Contracts {
  bondToken: ExpandedERC20Ethers;
  optimisticOracleV2: OptimisticOracleV2Ethers;
}

export const optimisticOracleV2Fixture = hre.deployments.createFixture(
  async ({ ethers }): Promise<OptimisticOracleV2Contracts> => {
    return await deployOptimisticOracleV2(ethers);
  }
);

export const deployOptimisticOracleV2 = hre.deployments.createFixture(
  async ({ ethers }): Promise<OptimisticOracleV2Contracts> => {
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

    // Adds default identifier for Optimistic Oracle V2 to the UMA identifierWhitelist.
    await parentFixture.identifierWhitelist.addSupportedIdentifier(defaultOptimisticOracleV2Identifier);

    // Deploy Optimistic Oracle V2 and add it to global hardhatTestingAddresses.
    const optimisticOracleV2 = (await (await getContractFactory("OptimisticOracleV2", deployer)).deploy(
      defaultLiveness,
      parentFixture.finder.address,
      parentFixture.timer.address
    )) as OptimisticOracleV2Ethers;

    addGlobalHardhatTestingAddress("OptimisticOracleV2", optimisticOracleV2.address);

    return { bondToken, optimisticOracleV2 };
  }
);
