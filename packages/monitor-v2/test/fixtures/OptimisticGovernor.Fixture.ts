import { addGlobalHardhatTestingAddress } from "@uma/common";
import {
  ExpandedERC20Ethers,
  ModuleProxyFactoryEthers,
  OptimisticGovernorEthers,
  OptimisticGovernorTestEthers,
  OptimisticOracleV3Ethers,
  TestAvatarEthers,
} from "@uma/contracts-node";
import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";
import { defaultCurrency, defaultLiveness, defaultOptimisticOracleV3Identifier } from "../constants";
import { formatBytes32String, getContractFactory, hre, parseEther, Signer } from "../utils";

export interface OptimisticGovernorContracts {
  bondToken: ExpandedERC20Ethers;
  optimisticOracleV3: OptimisticOracleV3Ethers;
  optimisticGovernor: OptimisticGovernorEthers;
  avatar: TestAvatarEthers;
  moduleProxyFactory: ModuleProxyFactoryEthers;
}

export const optimisticGovernorFixture = hre.deployments.createFixture(
  async ({ ethers }): Promise<OptimisticGovernorContracts> => {
    return await deployOptimisticGovernor(ethers);
  }
);

export const deployOptimisticGovernor = hre.deployments.createFixture(
  async ({ ethers }): Promise<OptimisticGovernorContracts> => {
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
    const optimisticOracleV3 = (await (await getContractFactory("OptimisticOracleV3Test", deployer)).deploy(
      parentFixture.finder.address,
      bondToken.address,
      defaultLiveness,
      parentFixture.timer.address
    )) as OptimisticOracleV3Ethers;

    await parentFixture.finder.changeImplementationAddress(
      formatBytes32String("OptimisticOracleV3"),
      optimisticOracleV3.address
    );

    addGlobalHardhatTestingAddress("OptimisticOracleV3", optimisticOracleV3.address);

    const avatar = (await (await getContractFactory("TestAvatar", deployer)).deploy()) as TestAvatarEthers;

    // Deploy Optimistic Governor and add it to global hardhatTestingAddresses.
    const rules = "https://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.ipfs.dweb.link/";
    const identifier = formatBytes32String("ZODIAC");
    const identifierTest = formatBytes32String("TEST");

    await parentFixture.identifierWhitelist.addSupportedIdentifier(identifier);
    await parentFixture.identifierWhitelist.addSupportedIdentifier(identifierTest);

    const liveness = 7200;
    const optimisticGovernor = (await (await getContractFactory("OptimisticGovernorTest", deployer)).deploy(
      parentFixture.finder.address,
      avatar.address,
      bondToken.address,
      parseEther("500"),
      rules,
      identifier,
      liveness,
      parentFixture.timer.address
    )) as OptimisticGovernorTestEthers;

    await avatar.setModule(optimisticGovernor.address);

    // Deploy ModuleProxyFactory.
    const moduleProxyFactory = (await (
      await getContractFactory("ModuleProxyFactory", deployer)
    ).deploy()) as ModuleProxyFactoryEthers;

    return { bondToken, optimisticOracleV3, optimisticGovernor, avatar, moduleProxyFactory };
  }
);
