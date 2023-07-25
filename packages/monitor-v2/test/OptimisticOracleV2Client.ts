import { ExpandedERC20Ethers, MockOracleAncillaryEthers, OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { optimisticOracleV2Fixture } from "./fixtures/OptimisticOracleV2.Fixture";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { Signer, hre, toUtf8Bytes } from "./utils";

const ethers = hre.ethers;

describe("OptimisticOracleV2Client", function () {
  let mockOracle: MockOracleAncillaryEthers;
  let bondToken: ExpandedERC20Ethers;
  let optimisticOracleV2: OptimisticOracleV2Ethers;
  let deployer: Signer;
  let asserter: Signer;
  let disputer: Signer;

  const bond = ethers.utils.parseEther("1000");

  const ancillaryData = toUtf8Bytes("This is just a test question");

  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [deployer, asserter, disputer] = (await ethers.getSigners()) as Signer[];

    // Get contract instances.
    mockOracle = (await umaEcosystemFixture()).mockOracle;
    const optimisticOracleV2Contracts = await optimisticOracleV2Fixture();
    bondToken = optimisticOracleV2Contracts.bondToken;
    optimisticOracleV2 = optimisticOracleV2Contracts.optimisticOracleV2;

    // Fund asserter and disputer with bond amount and approve Optimistic Oracle V2 to spend bond tokens.
    await bondToken.addMinter(await deployer.getAddress());
    await bondToken.mint(await asserter.getAddress(), bond);
    await bondToken.mint(await disputer.getAddress(), bond);
    await bondToken.connect(asserter).approve(optimisticOracleV2.address, bond);
    await bondToken.connect(disputer).approve(optimisticOracleV2.address, bond);
  });
  it("Works", async function () {
    mockOracle;
    ancillaryData;
    console.log("yes");
  });
});
