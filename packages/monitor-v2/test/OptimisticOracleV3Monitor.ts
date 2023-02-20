import { ExpandedERC20Ethers, MockOracleAncillaryEthers, OptimisticOracleV3Ethers } from "@uma/contracts-node";
import { defaultLiveness } from "./constants";
import { ContractTransaction, hardhatTime, hre, Signer, toUtf8Bytes } from "./utils";
import { umaEcosystemFixture } from "./fixtures/UmaEcosystem.Fixture";
import { optimisticOracleV3Fixture } from "./fixtures/OptimisticOracleV3.Fixture";

const ethers = hre.ethers;

// Get assertionId from the first AssertionMade event in the assertion transaction
const getAssertionId = async (
  tx: ContractTransaction,
  optimisticOracleV3: OptimisticOracleV3Ethers
): Promise<string> => {
  return (
    await optimisticOracleV3.queryFilter(optimisticOracleV3.filters.AssertionMade(), tx.blockNumber, tx.blockNumber)
  )[0].args.assertionId;
};

describe("OptimisticOracleV3Monitor", function () {
  let mockOracle: MockOracleAncillaryEthers;
  let bondToken: ExpandedERC20Ethers;
  let optimisticOracleV3: OptimisticOracleV3Ethers;
  let deployer: Signer;
  let asserter: Signer;
  let disputer: Signer;

  const claim = toUtf8Bytes("This is just a test claim");
  beforeEach(async function () {
    // Signer from ethers and hardhat-ethers are not version compatible, thus, we cannot use the SignerWithAddress.
    [deployer, asserter, disputer] = (await ethers.getSigners()) as Signer[];

    // Get contract instances.
    mockOracle = (await umaEcosystemFixture()).mockOracle;
    const optimisticOracleV3Contracts = await optimisticOracleV3Fixture();
    bondToken = optimisticOracleV3Contracts.bondToken;
    optimisticOracleV3 = optimisticOracleV3Contracts.optimisticOracleV3;

    // Fund asserter and disputer with minimum bond amount and approve Optimistic Oracle V3 to spend bond tokens.
    const minimumBondAmount = await optimisticOracleV3.getMinimumBond(bondToken.address);
    await bondToken.addMinter(await deployer.getAddress());
    await bondToken.mint(await asserter.getAddress(), minimumBondAmount);
    await bondToken.mint(await disputer.getAddress(), minimumBondAmount);
    await bondToken.connect(asserter).approve(optimisticOracleV3.address, minimumBondAmount);
    await bondToken.connect(disputer).approve(optimisticOracleV3.address, minimumBondAmount);
  });
  it("Monitor assertion", async function () {
    // Make assertion.
    await optimisticOracleV3.connect(asserter).assertTruthWithDefaults(claim, await asserter.getAddress());
  });
  it("Monitor truthful settlement", async function () {
    // Make assertion.
    const assertionTx = await optimisticOracleV3
      .connect(asserter)
      .assertTruthWithDefaults(claim, await asserter.getAddress());
    const assertionId = await getAssertionId(assertionTx, optimisticOracleV3);

    // Settle assertion after the liveness period.
    await hardhatTime.increase(defaultLiveness);
    await optimisticOracleV3.connect(asserter).settleAssertion(assertionId);
  });
  it("Monitor dispute", async function () {
    // Make assertion.
    const assertionTx = await optimisticOracleV3
      .connect(asserter)
      .assertTruthWithDefaults(claim, await asserter.getAddress());
    const assertionId = await getAssertionId(assertionTx, optimisticOracleV3);

    // Dispute assertion.
    await optimisticOracleV3.connect(disputer).disputeAssertion(assertionId, await disputer.getAddress());
  });
  it("Monitor settlement of false assertion", async function () {
    // Make assertion.
    const assertionTx = await optimisticOracleV3
      .connect(asserter)
      .assertTruthWithDefaults(claim, await asserter.getAddress());
    const assertionId = await getAssertionId(assertionTx, optimisticOracleV3);

    // Dispute assertion.
    const disputeTx = await optimisticOracleV3
      .connect(disputer)
      .disputeAssertion(assertionId, await disputer.getAddress());

    // Get oracle request from the first PriceRequestAdded event in the dispute transaction.
    const oracleRequest = (
      await mockOracle.queryFilter(mockOracle.filters.PriceRequestAdded(), disputeTx.blockNumber, disputeTx.blockNumber)
    )[0].args;

    // Resolve assertion as false.
    await mockOracle
      .connect(disputer)
      .pushPrice(oracleRequest.identifier, oracleRequest.time, oracleRequest.ancillaryData, 0);

    // Settle assertion.
    await optimisticOracleV3.connect(disputer).settleAssertion(assertionId);
  });
});
