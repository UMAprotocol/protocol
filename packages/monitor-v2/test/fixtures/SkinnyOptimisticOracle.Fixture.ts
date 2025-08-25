import { addGlobalHardhatTestingAddress } from "@uma/common";
import { ExpandedERC20Ethers } from "@uma/contracts-node";
import { Contract, BigNumber } from "ethers";
import { umaEcosystemFixture } from "./UmaEcosystem.Fixture";
import { defaultCurrency, defaultLiveness, defaultOptimisticOracleV2Identifier } from "../constants";
import { getContractFactory, hre, Signer } from "../utils";

// Define SkinnyOptimisticOracle interface for type safety
export interface SkinnyOptimisticOracleEthers extends Contract {
  // View functions
  getState(
    requester: string,
    identifier: string,
    timestamp: number,
    ancillaryData: string,
    request: any
  ): Promise<number>;
  requests(requestId: string): Promise<string>;

  // State-changing functions
  requestPrice(
    identifier: string,
    timestamp: number,
    ancillaryData: string,
    currency: string,
    reward: BigNumber,
    bond: BigNumber,
    customLiveness: number
  ): Promise<any>;
  proposePrice(
    requester: string,
    identifier: string,
    timestamp: number,
    ancillaryData: string,
    request: any,
    proposedPrice: string
  ): Promise<any>;
  settle(requester: string, identifier: string, timestamp: number, ancillaryData: string, request: any): Promise<any>;

  // Events
  filters: {
    RequestPrice(...args: any[]): any;
    Settle(...args: any[]): any;
  };
}

export interface SkinnyOptimisticOracleContracts {
  bondToken: ExpandedERC20Ethers;
  skinnyOptimisticOracle: SkinnyOptimisticOracleEthers;
}

export const skinnyOptimisticOracleFixture = hre.deployments.createFixture(
  async ({ ethers }): Promise<SkinnyOptimisticOracleContracts> => {
    return await deploySkinnyOptimisticOracle(ethers);
  }
);

export const deploySkinnyOptimisticOracle = hre.deployments.createFixture(
  async ({ ethers }): Promise<SkinnyOptimisticOracleContracts> => {
    // Signer from ethers and hardhat-ethers are not version compatible.
    const [deployer] = (await ethers.getSigners()) as Signer[];

    // This fixture is dependent on the UMA ecosystem fixture. Run it first and grab the output.
    const parentFixture = await umaEcosystemFixture();

    // Deploy default currency for SkinnyOptimisticOracle.
    const bondToken = (await (await getContractFactory("ExpandedERC20", deployer)).deploy(
      defaultCurrency.name,
      defaultCurrency.symbol,
      defaultCurrency.decimals
    )) as ExpandedERC20Ethers;

    // Sets default currency as approved in the UMA collateralWhitelist.
    await parentFixture.collateralWhitelist.addToWhitelist(bondToken.address);

    // Sets finalFee for default currency.
    await parentFixture.store.setFinalFee(bondToken.address, { rawValue: defaultCurrency.finalFee });

    // Adds default identifier for SkinnyOptimisticOracle to the UMA identifierWhitelist.
    await parentFixture.identifierWhitelist.addSupportedIdentifier(defaultOptimisticOracleV2Identifier);

    // Deploy SkinnyOptimisticOracle
    const SkinnyOptimisticOracleFactory = await getContractFactory("SkinnyOptimisticOracle", deployer);

    const skinnyOptimisticOracle = (await SkinnyOptimisticOracleFactory.deploy(
      defaultLiveness,
      parentFixture.finder.address,
      parentFixture.timer.address
    )) as SkinnyOptimisticOracleEthers;

    addGlobalHardhatTestingAddress("SkinnyOptimisticOracle", skinnyOptimisticOracle.address);

    return { bondToken, skinnyOptimisticOracle };
  }
);
