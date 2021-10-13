const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
// Helper scripts
const { LiquidationStatesEnum, didContractThrow, MAX_UINT_VAL } = require("@uma/common");
const { interfaceName } = require("@uma/common");
const { assert } = require("chai");
const { toWei, fromWei, hexToUtf8, toBN, utf8ToHex, padRight } = web3.utils;

// Helper Contracts
const Token = getContract("ExpandedERC20");
const SyntheticToken = getContract("SyntheticToken");
const TestnetERC20 = getContract("TestnetERC20");

// Contracts to unit test
const Liquidatable = getContract("Liquidatable");

// Other UMA related contracts and mocks
const Store = getContract("Store");
const Finder = getContract("Finder");
const MockOracle = getContract("MockOracle");
const AddressWhitelist = getContract("AddressWhitelist");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const FinancialContractsAdmin = getContract("FinancialContractsAdmin");
const FinancialProductLibraryTest = getContract("FinancialProductLibraryTest");
const Timer = getContract("Timer");

describe("Liquidatable", function () {
  let accounts;
  // Roles
  let contractDeployer;
  let sponsor;
  let liquidator;
  let disputer;
  let rando;
  const zeroAddress = "0x0000000000000000000000000000000000000000";

  // Amount of tokens to mint for test
  const amountOfCollateral = toBN(toWei("150"));
  const amountOfSynthetic = toBN(toWei("100"));
  const pricePerToken = toBN(toWei("1.5"));

  // Settlement price
  const settlementPrice = toBN(toWei("1"));

  // Settlement TRV
  const settlementTRV = amountOfSynthetic.mul(settlementPrice).div(toBN(toWei("1")));

  // Liquidation contract params
  const disputeBondPercentage = toBN(toWei("0.1"));
  const disputeBond = disputeBondPercentage.mul(amountOfCollateral).div(toBN(toWei("1")));
  const collateralRequirement = toBN(toWei("1.2"));
  const sponsorDisputeRewardPercentage = toBN(toWei("0.05"));
  const sponsorDisputeReward = sponsorDisputeRewardPercentage.mul(settlementTRV).div(toBN(toWei("1")));
  const disputerDisputeRewardPercentage = toBN(toWei("0.05"));
  const disputerDisputeReward = disputerDisputeRewardPercentage.mul(settlementTRV).div(toBN(toWei("1")));
  const liquidationLiveness = toBN(60).muln(60).muln(3); // In seconds
  const startTime = "15798990420";
  const minSponsorTokens = toBN(toWei("1"));

  // Synthetic Token Position contract params
  const positionLiveness = toBN(60 * 60).mul(liquidationLiveness); // Add this to liquidation liveness so we can create more positions post-liquidation
  const expirationTimestamp = toBN(startTime).add(positionLiveness).toString();
  const withdrawalLiveness = toBN(60).muln(60).muln(1);
  const pendingWithdrawalAmount = "0"; // Amount to liquidate can be less than amount of collateral iff there is a pending withdrawal
  const amountOfCollateralToLiquidate = amountOfCollateral.add(toBN(pendingWithdrawalAmount));
  const unreachableDeadline = MAX_UINT_VAL;

  // Set final fee to a flat 1 collateral token.
  const finalFeeAmount = toBN(toWei("1"));

  // Contracts
  let liquidationContract;
  let collateralToken;
  let syntheticToken;
  let identifierWhitelist;
  let priceFeedIdentifier;
  let collateralWhitelist;
  let mockOracle;
  let finder;
  let liquidatableParameters;
  let store;
  let financialContractsAdmin;
  let timer;

  // Basic liquidation params
  const liquidationParams = {
    liquidationId: 0,
    falseLiquidationId: 123456789,
    tokensOutstanding: amountOfSynthetic,
    lockedCollateral: amountOfCollateral,
    liquidatedCollateral: amountOfCollateralToLiquidate,
  };

  before(async () => {
    accounts = await web3.eth.getAccounts();
    [contractDeployer, sponsor, liquidator, disputer, rando] = accounts;
    await runDefaultFixture(hre);

    // Get deployed contracts.
    timer = await Timer.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    finder = await Finder.deployed();
    store = await Store.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    financialContractsAdmin = await FinancialContractsAdmin.deployed();
  });

  beforeEach(async () => {
    // Force each test to start with a simulated time that's synced to the startTimestamp.
    await timer.methods.setCurrentTime(startTime).send({ from: accounts[0] });

    // Create Collateral and Synthetic ERC20's
    collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: contractDeployer });
    syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: contractDeployer });

    // Register the price tracking ticker.
    priceFeedIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: contractDeployer });

    // Create mock oracle and register it with the finder.
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: contractDeployer });

    const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
    await finder.methods
      .changeImplementationAddress(mockOracleInterfaceName, mockOracle.options.address)
      .send({ from: contractDeployer });

    liquidatableParameters = {
      expirationTimestamp: expirationTimestamp,
      withdrawalLiveness: withdrawalLiveness.toString(),
      collateralAddress: collateralToken.options.address,
      tokenAddress: syntheticToken.options.address,
      finderAddress: finder.options.address,
      priceFeedIdentifier: priceFeedIdentifier,
      liquidationLiveness: liquidationLiveness.toString(),
      collateralRequirement: { rawValue: collateralRequirement.toString() },
      disputeBondPercentage: { rawValue: disputeBondPercentage.toString() },
      sponsorDisputeRewardPercentage: { rawValue: sponsorDisputeRewardPercentage.toString() },
      disputerDisputeRewardPercentage: { rawValue: disputerDisputeRewardPercentage.toString() },
      minSponsorTokens: { rawValue: minSponsorTokens.toString() },
      timerAddress: timer.options.address,
      financialProductLibraryAddress: zeroAddress,
    };

    // Deploy liquidation contract and set global params
    liquidationContract = await Liquidatable.new(liquidatableParameters).send({ from: contractDeployer });

    // Hand over synthetic token permissions to the new derivative contract
    await syntheticToken.methods.addMinter(liquidationContract.options.address).send({ from: accounts[0] });
    await syntheticToken.methods.addBurner(liquidationContract.options.address).send({ from: accounts[0] });

    // Reset start time signifying the beginning of the first liquidation
    await liquidationContract.methods.setCurrentTime(startTime).send({ from: accounts[0] });

    // Mint collateral to sponsor
    await collateralToken.methods.addMember(1, contractDeployer).send({ from: contractDeployer });
    await collateralToken.methods.mint(sponsor, amountOfCollateral).send({ from: contractDeployer });

    // Mint dispute bond to disputer
    await collateralToken.methods.mint(disputer, disputeBond.add(finalFeeAmount)).send({ from: contractDeployer });

    // Set allowance for contract to pull collateral tokens from sponsor
    await collateralToken.methods
      .increaseAllowance(liquidationContract.options.address, amountOfCollateral)
      .send({ from: sponsor });

    // Set allowance for contract to pull dispute bond and final fee from disputer
    await collateralToken.methods
      .increaseAllowance(liquidationContract.options.address, disputeBond.add(finalFeeAmount))
      .send({ from: disputer });

    // Set allowance for contract to pull the final fee from the liquidator
    await collateralToken.methods
      .increaseAllowance(liquidationContract.options.address, finalFeeAmount)
      .send({ from: liquidator });

    // Set allowance for contract to pull synthetic tokens from liquidator
    await syntheticToken.methods
      .increaseAllowance(liquidationContract.options.address, amountOfSynthetic)
      .send({ from: liquidator });

    await collateralWhitelist.methods.addToWhitelist(collateralToken.options.address).send({ from: accounts[0] });
  });

  describe("Attempting to liquidate a position that does not exist", () => {
    it("should revert", async () => {
      assert(
        await didContractThrow(
          liquidationContract.methods
            .createLiquidation(
              sponsor,
              { rawValue: "0" },
              { rawValue: pricePerToken.toString() },
              { rawValue: amountOfSynthetic.toString() },
              unreachableDeadline
            )
            .send({ from: liquidator })
        )
      );
    });
  });

  describe("Creating a liquidation on a valid position", () => {
    beforeEach(async () => {
      // Create position
      await liquidationContract.methods
        .create({ rawValue: amountOfCollateral.toString() }, { rawValue: amountOfSynthetic.toString() })
        .send({ from: sponsor });
      // Transfer synthetic tokens to a liquidator
      await syntheticToken.methods.transfer(liquidator, amountOfSynthetic).send({ from: sponsor });
    });
    it("Liquidator does not have enough tokens to retire position", async () => {
      await syntheticToken.methods.transfer(contractDeployer, toWei("1")).send({ from: liquidator });
      assert(
        await didContractThrow(
          liquidationContract.methods
            .createLiquidation(
              sponsor,
              { rawValue: "0" },
              { rawValue: pricePerToken.toString() },
              { rawValue: amountOfSynthetic.toString() },
              unreachableDeadline
            )
            .send({ from: liquidator })
        )
      );
    });
    it("Liquidation is mined after the deadline", async () => {
      const currentTime = parseInt(await liquidationContract.methods.getCurrentTime().call());
      assert(
        await didContractThrow(
          liquidationContract.methods
            .createLiquidation(
              sponsor,
              { rawValue: "0" },
              { rawValue: pricePerToken.toString() },
              { rawValue: amountOfSynthetic.toString() },
              currentTime - 1
            )
            .send({ from: liquidator })
        )
      );
    });
    it("Liquidation is mined before the deadline", async () => {
      const currentTime = parseInt(await liquidationContract.methods.getCurrentTime().call());
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          currentTime + 1
        )
        .send({ from: liquidator });
    });
    it("Collateralization is out of bounds", async () => {
      assert(
        await didContractThrow(
          liquidationContract.methods
            .createLiquidation(
              sponsor,
              { rawValue: "0" }, // The `maxCollateralPerToken` is below the actual collateral per token, so the liquidate call should fail.
              { rawValue: pricePerToken.subn(1).toString() },
              { rawValue: amountOfSynthetic.toString() },
              unreachableDeadline
            )
            .send({ from: liquidator })
        )
      );
      assert(
        await didContractThrow(
          liquidationContract.methods
            .createLiquidation(
              sponsor, // The `minCollateralPerToken` is above the actual collateral per token, so the liquidate call should fail.
              { rawValue: pricePerToken.addn(1).toString() },
              { rawValue: pricePerToken.addn(2).toString() },
              { rawValue: amountOfSynthetic.toString() },
              unreachableDeadline
            )
            .send({ from: liquidator })
        )
      );
    });
    it("Returns correct ID", async () => {
      const { liquidationId } = await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .call({ from: liquidator });
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });
      assert.equal(liquidationId.toString(), liquidationParams.liquidationId.toString());
    });
    it("Fails if contract does not have Burner role", async () => {
      await syntheticToken.methods.removeBurner(liquidationContract.options.address).send({ from: accounts[0] });

      // This liquidation should normally succeed using the same parameters as other successful liquidations, {       // such as in the previous test.
      assert(
        await didContractThrow(
          liquidationContract.methods
            .createLiquidation(
              sponsor,
              { rawValue: "0" },
              { rawValue: pricePerToken.toString() },
              { rawValue: amountOfSynthetic.toString() },
              unreachableDeadline
            )
            .send({ from: liquidator })
        )
      );
    });
    it("Pulls correct token amount", async () => {
      const { tokensLiquidated } = await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .call({ from: liquidator });

      // Should return the correct number of tokens.
      assert.equal(tokensLiquidated.toString(), amountOfSynthetic.toString());

      const intitialBalance = toBN(await syntheticToken.methods.balanceOf(liquidator).call());
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });

      // Synthetic balance decrease should equal amountOfSynthetic.
      assert.equal(
        intitialBalance.sub(toBN(await syntheticToken.methods.balanceOf(liquidator).call())),
        amountOfSynthetic.toString()
      );
    });
    it("Liquidator pays final fee", async () => {
      // Mint liquidator enough tokens to pay the final fee.
      await collateralToken.methods.mint(liquidator, finalFeeAmount).send({ from: contractDeployer });

      // Set final fee.
      await store.methods
        .setFinalFee(collateralToken.options.address, { rawValue: finalFeeAmount.toString() })
        .send({ from: accounts[0] });

      const { finalFeeBond } = await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .call({ from: liquidator });
      // Should return the correct final fee amount.
      assert.equal(finalFeeBond.toString(), finalFeeAmount.toString());

      const intitialBalance = toBN(await collateralToken.methods.balanceOf(liquidator).call());
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });

      // Collateral balance change should equal the final fee.
      assert.equal(
        intitialBalance.sub(toBN(await collateralToken.methods.balanceOf(liquidator).call())).toString(),
        finalFeeAmount.toString()
      );

      // Reset final fee to 0.
      await store.methods.setFinalFee(collateralToken.options.address, { rawValue: "0" }).send({ from: accounts[0] });
    });
    it("Emits an event", async () => {
      const createLiquidationResult = await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });
      const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
      await assertEventEmitted(createLiquidationResult, liquidationContract, "LiquidationCreated", (ev) => {
        return (
          ev.sponsor == sponsor &&
          ev.liquidator == liquidator &&
          ev.liquidationId == 0 &&
          ev.tokensOutstanding == amountOfSynthetic.toString() &&
          ev.lockedCollateral == amountOfCollateral.toString() &&
          ev.liquidatedCollateral == amountOfCollateral.toString() &&
          ev.liquidationTime == liquidationTime.toString()
        );
      });
      await assertEventEmitted(createLiquidationResult, liquidationContract, "EndedSponsorPosition", (ev) => {
        return ev.sponsor == sponsor;
      });
    });
    it("Increments ID after creation", async () => {
      // Create first liquidation
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });

      // Open a new position:
      // - Mint collateral to sponsor
      await collateralToken.methods.mint(sponsor, amountOfCollateral).send({ from: contractDeployer });
      // - Set allowance for contract to pull collateral tokens from sponsor
      await collateralToken.methods
        .increaseAllowance(liquidationContract.options.address, amountOfCollateral)
        .send({ from: sponsor });
      // - Create position
      await liquidationContract.methods
        .create({ rawValue: amountOfCollateral.toString() }, { rawValue: amountOfSynthetic.toString() })
        .send({ from: sponsor });
      // - Set allowance for contract to pull synthetic tokens from liquidator
      await syntheticToken.methods
        .increaseAllowance(liquidationContract.options.address, amountOfSynthetic)
        .send({ from: liquidator });
      // - Transfer synthetic tokens to a liquidator
      await syntheticToken.methods.transfer(liquidator, amountOfSynthetic).send({ from: sponsor });

      // Create second liquidation
      const { liquidationId } = await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .call({ from: liquidator });
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });
      assert.equal(liquidationId.toString(), toBN(liquidationParams.liquidationId).addn(1).toString());
    });
    it("Partial liquidation", async () => {
      // Request a withdrawal.
      const withdrawalAmount = amountOfSynthetic.divn(5);
      await liquidationContract.methods
        .requestWithdrawal({ rawValue: withdrawalAmount.toString() })
        .send({ from: sponsor });

      // Position starts out with `amountOfSynthetic` tokens.
      const expectedLiquidatedTokens = amountOfSynthetic.divn(5);
      const expectedRemainingTokens = amountOfSynthetic.sub(expectedLiquidatedTokens);

      // Position starts out with `amountOfCollateral` collateral.
      const expectedLockedCollateral = amountOfCollateral.divn(5);
      const expectedRemainingCollateral = amountOfCollateral.sub(expectedLockedCollateral);
      const expectedRemainingWithdrawalRequest = withdrawalAmount.sub(withdrawalAmount.divn(5));

      // Create partial liquidation.
      let { liquidationId, tokensLiquidated } = await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.divn(5).toString() },
          unreachableDeadline
        )
        .call({ from: liquidator });
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.divn(5).toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });
      let position = await liquidationContract.methods.positions(sponsor).call();
      let liquidation = await liquidationContract.methods.liquidations(sponsor, liquidationId).call();
      assert.equal(expectedRemainingTokens.toString(), position.tokensOutstanding.toString());
      assert.equal(expectedRemainingWithdrawalRequest.toString(), position.withdrawalRequestAmount.toString());
      assert.equal(
        expectedRemainingCollateral.toString(),
        (await liquidationContract.methods.getCollateral(sponsor).call()).toString()
      );
      assert.equal(expectedLiquidatedTokens.toString(), liquidation.tokensOutstanding.toString());
      assert.equal(expectedLockedCollateral.toString(), liquidation.lockedCollateral.toString());
      assert.equal(expectedLiquidatedTokens.toString(), tokensLiquidated.toString());

      // A independent and identical liquidation can be created.
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" }, // Due to rounding problems, have to increase the pricePerToken.
          { rawValue: pricePerToken.muln(2).toString() },
          { rawValue: amountOfSynthetic.divn(5).toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });
      ({ liquidationId } = await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.divn(5).toString() },
          unreachableDeadline
        )
        .call({ from: liquidator }));
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.divn(5).toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });
      liquidation = await liquidationContract.methods.liquidations(sponsor, liquidationId).call();
      assert.equal(expectedLiquidatedTokens.toString(), liquidation.tokensOutstanding.toString());
      // Due to rounding, compare that locked collateral is close to what expect.
      assert.isTrue(
        expectedLockedCollateral
          .sub(toBN(liquidation.lockedCollateral.toString()))
          .abs()
          .lte(toBN(toWei("0.0001")))
      );
    });
    it("Cannot create partial liquidation that sends sponsor below minimum", async () => {
      const liquidationAmount = amountOfSynthetic.sub(toBN(toWei("0.99")));

      // Liquidation should fail because it would leave only 0.99 tokens, which is below the min.
      // Note: multiply the pricePerToken by 2 to ensure the max doesn't cause the transaction to fail.
      assert(
        await didContractThrow(
          liquidationContract.methods
            .createLiquidation(
              sponsor,
              { rawValue: "0" },
              { rawValue: pricePerToken.muln(2).toString() },
              { rawValue: liquidationAmount.toString() },
              unreachableDeadline
            )
            .send({ from: liquidator })
        )
      );
    });
    it("Multiple partial liquidations re-set liveness timer on withdrawal requests", async () => {
      // Request a withdrawal.
      const withdrawalAmount = amountOfSynthetic.divn(5);
      await liquidationContract.methods
        .requestWithdrawal({ rawValue: withdrawalAmount.toString() })
        .send({ from: sponsor });

      const startingTime = toBN(await liquidationContract.methods.getCurrentTime().call());
      let expectedTimestamp = toBN(startingTime).add(withdrawalLiveness).toString();

      assert.equal(
        expectedTimestamp,
        (await liquidationContract.methods.positions(sponsor).call()).withdrawalRequestPassTimestamp.toString()
      );

      // Advance time by half of the liveness duration.
      await liquidationContract.methods
        .setCurrentTime(startingTime.add(withdrawalLiveness.divn(2)).toString())
        .send({ from: accounts[0] });

      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.divn(5).toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });

      // After the liquidation the liveness timer on the withdrawl request should be re-set to the current time +
      // the liquidation liveness. This opens the position up to having a subsequent liquidation, if need be.
      const liquidation1Time = parseInt(await liquidationContract.methods.getCurrentTime().call());
      assert.equal(
        (liquidation1Time + withdrawalLiveness.toNumber()).toString(),
        (await liquidationContract.methods.positions(sponsor).call()).withdrawalRequestPassTimestamp.toString()
      );

      // Create a subsequent liquidation partial and check that it also advances the withdrawal request timer
      await liquidationContract.methods
        .setCurrentTime(liquidation1Time + withdrawalLiveness.toNumber() / 2)
        .send({ from: accounts[0] });

      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.divn(5).toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });

      // Again, verify this is offset correctly.
      const liquidation2Time = parseInt(await liquidationContract.methods.getCurrentTime().call());
      const expectedWithdrawalRequestPassTimestamp = (liquidation2Time + withdrawalLiveness.toNumber()).toString();
      assert.equal(
        expectedWithdrawalRequestPassTimestamp,
        (await liquidationContract.methods.positions(sponsor).call()).withdrawalRequestPassTimestamp.toString()
      );

      // Submitting a liquidation less than the minimum sponsor size should not advance the timer. Start by advancing
      // time by half of the liquidation liveness.
      await liquidationContract.methods
        .setCurrentTime(liquidation2Time + withdrawalLiveness.toNumber() / 2)
        .send({ from: accounts[0] });
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: minSponsorTokens.divn(2).toString() }, // half of the min size. Should not increment timer.
          unreachableDeadline
        )
        .send({ from: liquidator });

      // Check that the timer has not re-set. expectedWithdrawalRequestPassTimestamp was set after the previous
      // liquidation (before incrementing the time).

      assert.equal(
        expectedWithdrawalRequestPassTimestamp,
        (await liquidationContract.methods.positions(sponsor).call()).withdrawalRequestPassTimestamp.toString()
      );

      // Advance timer again to place time after liquidation liveness.
      await liquidationContract.methods
        .setCurrentTime(liquidation2Time + withdrawalLiveness.toNumber())
        .send({ from: accounts[0] });

      // Now, submitting a withdrawal request should NOT reset liveness (sponsor has passed liveness duration).
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.divn(5).toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });

      // Check that the time has not advanced.
      assert.equal(
        expectedWithdrawalRequestPassTimestamp,
        (await liquidationContract.methods.positions(sponsor).call()).withdrawalRequestPassTimestamp.toString()
      );
    });
  });

  describe("Full liquidation has been created", () => {
    // Used to catch events.
    let liquidationResult;
    let liquidationTime;

    beforeEach(async () => {
      // Create position
      await liquidationContract.methods
        .create({ rawValue: amountOfCollateral.toString() }, { rawValue: amountOfSynthetic.toString() })
        .send({ from: sponsor });

      // Set final fee before initiating the liquidation.
      await store.methods
        .setFinalFee(collateralToken.options.address, { rawValue: finalFeeAmount.toString() })
        .send({ from: accounts[0] });

      // Transfer synthetic tokens to a liquidator
      await syntheticToken.methods.transfer(liquidator, amountOfSynthetic).send({ from: sponsor });

      // Mint a single collateral token for the liquidator.
      await collateralToken.methods.mint(liquidator, finalFeeAmount).send({ from: contractDeployer });

      // Create a Liquidation
      liquidationTime = await liquidationContract.methods.getCurrentTime().call();
      liquidationResult = await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });

      // Reset final fee to 0.
      await store.methods.setFinalFee(collateralToken.options.address, { rawValue: "0" }).send({ from: accounts[0] });
    });

    describe("Get a Liquidation", () => {
      it("Liquidator burned synthetic tokens", async () => {
        assert.equal((await syntheticToken.methods.balanceOf(liquidator).call()).toString(), "0");
        assert.equal((await syntheticToken.methods.totalSupply().call()).toString(), "0");
      });
      it("Liquidation decrease underlying token debt and collateral", async () => {
        const totalPositionCollateralAfter = await liquidationContract.methods.totalPositionCollateral().call();
        assert.equal(totalPositionCollateralAfter.rawValue, "0");
        const totalTokensOutstandingAfter = await liquidationContract.methods.totalTokensOutstanding().call();
        assert.equal(totalTokensOutstandingAfter.toString(), "0");
      });
      it("Liquidation exists and params are set properly", async () => {
        const newLiquidation = await liquidationContract.methods
          .liquidations(sponsor, liquidationParams.liquidationId)
          .call();
        assert.equal(newLiquidation.state.toString(), LiquidationStatesEnum.PRE_DISPUTE);
        assert.equal(newLiquidation.tokensOutstanding.toString(), liquidationParams.tokensOutstanding.toString());
        assert.equal(newLiquidation.lockedCollateral.toString(), liquidationParams.lockedCollateral.toString());
        assert.equal(newLiquidation.liquidatedCollateral.toString(), liquidationParams.liquidatedCollateral.toString());
        assert.equal(newLiquidation.liquidator, liquidator);
        assert.equal(newLiquidation.disputer, zeroAddress);
        assert.equal(newLiquidation.liquidationTime.toString(), liquidationTime.toString());
        assert.equal(newLiquidation.settlementPrice.toString(), "0");
      });
      it("EndedSponsorPosition event was emitted", async () => {
        await assertEventEmitted(liquidationResult, liquidationContract, "EndedSponsorPosition", (ev) => {
          return ev.sponsor == sponsor;
        });
      });
      it("Liquidation does not exist", async () => {
        assert(
          await didContractThrow(
            liquidationContract.methods
              .liquidations(sponsor, liquidationParams.falseLiquidationId)
              .send({ from: accounts[0] })
          )
        );
      });
    });

    describe("Dispute a Liquidation", () => {
      it("Liquidation does not exist", async () => {
        assert(
          await didContractThrow(
            liquidationContract.methods.dispute(liquidationParams.falseLiquidationId, sponsor).send({ from: disputer })
          )
        );
      });
      it("Liquidation already expired", async () => {
        await liquidationContract.methods
          .setCurrentTime(toBN(startTime).add(liquidationLiveness).toString())
          .send({ from: accounts[0] });
        assert(
          await didContractThrow(
            liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer })
          )
        );
      });
      it("Disputer does not have enough tokens", async () => {
        await collateralToken.methods.transfer(contractDeployer, toWei("1")).send({ from: disputer });
        assert(
          await didContractThrow(
            liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer })
          )
        );
      });
      it("Request to dispute succeeds and Liquidation params changed correctly", async () => {
        const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
        await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
        assert.equal((await collateralToken.methods.balanceOf(disputer).call()).toString(), "0");
        const liquidation = await liquidationContract.methods
          .liquidations(sponsor, liquidationParams.liquidationId)
          .call();
        assert.equal(liquidation.state.toString(), LiquidationStatesEnum.PENDING_DISPUTE);
        assert.equal(liquidation.disputer, disputer);
        assert.equal(liquidation.liquidationTime.toString(), liquidationTime.toString());
      });
      it("Dispute emits an event", async () => {
        const disputeResult = await liquidationContract.methods
          .dispute(liquidationParams.liquidationId, sponsor)
          .send({ from: disputer });
        await assertEventEmitted(disputeResult, liquidationContract, "LiquidationDisputed", (ev) => {
          return (
            ev.sponsor == sponsor &&
            ev.liquidator == liquidator &&
            ev.disputer == disputer &&
            ev.liquidationId == 0 &&
            ev.disputeBondAmount == toWei("15").toString() // 10% of the collateral as disputeBondPercentage * amountOfCollateral
          );
        });
      });
      it("Dispute initiates an oracle call", async () => {
        const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
        await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
        // Oracle should have an enqueued price after calling dispute
        const pendingRequests = await mockOracle.methods.getPendingQueries().call();
        assert.equal(hexToUtf8(pendingRequests[0]["identifier"]), hexToUtf8(priceFeedIdentifier));
        assert.equal(pendingRequests[0].time, liquidationTime);
      });
      it("Dispute pays a final fee", async () => {
        // Mint final fee amount to disputer
        await collateralToken.methods.mint(disputer, finalFeeAmount).send({ from: contractDeployer });

        // Returns correct total bond.
        const totalPaid = await liquidationContract.methods
          .dispute(liquidationParams.liquidationId, sponsor)
          .call({ from: disputer });
        assert.equal(totalPaid.toString(), disputeBond.add(finalFeeAmount).toString());

        // Check that store's collateral balance increases
        const storeInitialBalance = toBN(await collateralToken.methods.balanceOf(store.options.address).call());
        await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
        const storeAfterDisputeBalance = toBN(await collateralToken.methods.balanceOf(store.options.address).call());
        assert.equal(storeAfterDisputeBalance.sub(storeInitialBalance).toString(), finalFeeAmount);

        // Check that the contract only has one final fee refund, not two.
        const expectedContractBalance = toBN(amountOfCollateral).add(disputeBond).add(finalFeeAmount);
        assert.equal(
          (await collateralToken.methods.balanceOf(liquidationContract.options.address).call()).toString(),
          expectedContractBalance.toString()
        );
      });
      it("Throw if liquidation has already been disputed", async () => {
        // Mint final fee amount to disputer
        await collateralToken.methods.mint(disputer, finalFeeAmount).send({ from: contractDeployer });

        await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
        // Mint enough tokens to disputer for another dispute bond
        await collateralToken.methods.mint(disputer, disputeBond).send({ from: contractDeployer });
        await collateralToken.methods
          .increaseAllowance(liquidationContract.options.address, disputeBond)
          .send({ from: disputer });
        assert(
          await didContractThrow(
            liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer })
          )
        );
        assert.equal(
          (await collateralToken.methods.balanceOf(disputer).call()).toString(),
          disputeBond.add(finalFeeAmount).toString()
        );
      });
      // Weird edge cases, test anyways:
      it("Liquidation already disputed successfully", async () => {
        // Mint final fee amount to disputer
        await collateralToken.methods.mint(disputer, finalFeeAmount).send({ from: contractDeployer });

        await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });

        // Push to oracle.
        const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
        await mockOracle.methods
          .pushPrice(priceFeedIdentifier, liquidationTime, settlementPrice.toString())
          .send({ from: accounts[0] });

        // Mint enough tokens to disputer for another dispute bond
        await collateralToken.methods.mint(disputer, disputeBond).send({ from: contractDeployer });
        assert(
          await didContractThrow(
            liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer })
          )
        );
        assert.equal(
          (await collateralToken.methods.balanceOf(disputer).call()).toString(),
          disputeBond.add(finalFeeAmount).toString()
        );
      });
      it("Liquidation already disputed unsuccessfully", async () => {
        // Mint final fee amount to disputer
        await collateralToken.methods.mint(disputer, finalFeeAmount).send({ from: contractDeployer });

        await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });

        // Push to oracle.
        const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
        await mockOracle.methods
          .pushPrice(priceFeedIdentifier, liquidationTime, settlementPrice.toString())
          .send({ from: accounts[0] });

        // Mint enough tokens to disputer for another dispute bond
        await collateralToken.methods.mint(disputer, disputeBond).send({ from: contractDeployer });
        assert(
          await didContractThrow(
            liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer })
          )
        );
        assert.equal(
          (await collateralToken.methods.balanceOf(disputer).call()).toString(),
          disputeBond.add(finalFeeAmount).toString()
        );
      });
    });

    describe("Settle Dispute: there is not pending dispute", () => {
      it("Cannot settle a Liquidation before a dispute request", async () => {
        assert(
          await didContractThrow(
            liquidationContract.methods
              .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
              .send({ from: accounts[0] })
          )
        );
      });
    });

    describe("Settle Dispute: there is a pending dispute", () => {
      beforeEach(async () => {
        // Mint final fee amount to disputer
        await collateralToken.methods.mint(disputer, finalFeeAmount).send({ from: contractDeployer });

        // Dispute the created liquidation
        await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
      });
      it("Settlement price set properly, liquidation is deleted", async () => {
        // After the dispute call the oracle is requested a price. As such, push a price into the oracle at that
        // timestamp for the contract price identifer. Check that the value is set correctly for the dispute object.
        const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
        const disputePrice = toWei("1");
        await mockOracle.methods
          .pushPrice(priceFeedIdentifier, liquidationTime, disputePrice)
          .send({ from: accounts[0] });
        const withdrawTxn = await liquidationContract.methods
          .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
          .send({ from: accounts[0] });

        await assertEventEmitted(withdrawTxn, liquidationContract, "LiquidationWithdrawn", (ev) => {
          return ev.settlementPrice.toString() === disputePrice;
        });

        // Check if liquidation data is deleted
        const liquidation = await liquidationContract.methods
          .liquidations(sponsor, liquidationParams.liquidationId)
          .call();
        assert.equal(liquidation.state.toString(), LiquidationStatesEnum.UNINITIALIZED);

        // Cannot withdraw again.
        assert(
          await didContractThrow(
            liquidationContract.methods
              .withdrawLiquidation(liquidationParams.falseLiquidationId, sponsor)
              .send({ from: accounts[0] })
          )
        );
      });
      it("Dispute Succeeded", async () => {
        // For a successful dispute the price needs to result in the position being correctly collateralized (to invalidate the
        // liquidation). Any price below 1.25 for a debt of 100 with 150 units of underlying should result in successful dispute.

        const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
        const disputePrice = toWei("1");
        await mockOracle.methods
          .pushPrice(priceFeedIdentifier, liquidationTime, disputePrice)
          .send({ from: accounts[0] });

        const withdrawTxn = await liquidationContract.methods
          .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
          .send({ from: accounts[0] });

        await assertEventEmitted(withdrawTxn, liquidationContract, "DisputeSettled", (ev) => {
          return ev.disputeSucceeded;
        });
        await assertEventEmitted(withdrawTxn, liquidationContract, "LiquidationWithdrawn", (ev) => {
          return ev.liquidationStatus.toString() === LiquidationStatesEnum.DISPUTE_SUCCEEDED;
        });
      });
      it("Dispute Failed", async () => {
        // For a failed dispute the price needs to result in the position being incorrectly collateralized (the liquidation is valid).
        // Any price above 1.25 for a debt of 100 with 150 units of underlying should result in failed dispute and a successful liquidation.

        const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
        const disputePrice = toWei("1.3");
        await mockOracle.methods
          .pushPrice(priceFeedIdentifier, liquidationTime, disputePrice)
          .send({ from: accounts[0] });
        const withdrawLiquidationResult = await liquidationContract.methods
          .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
          .send({ from: accounts[0] });

        // Events should show that the dispute failed.
        await assertEventEmitted(withdrawLiquidationResult, liquidationContract, "DisputeSettled", (ev) => {
          return !ev.disputeSucceeded;
        });
        await assertEventEmitted(withdrawLiquidationResult, liquidationContract, "LiquidationWithdrawn", (ev) => {
          return ev.liquidationStatus.toString() === LiquidationStatesEnum.DISPUTE_FAILED;
        });
      });
      it("Events correctly emitted", async () => {
        // Create a successful dispute and check the event is correct.

        const disputeTime = await liquidationContract.methods.getCurrentTime().call();
        const disputePrice = toWei("1");
        await mockOracle.methods.pushPrice(priceFeedIdentifier, disputeTime, disputePrice).send({ from: accounts[0] });

        const withdrawLiquidationResult = await liquidationContract.methods
          .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
          .send({ from: accounts[0] });

        await assertEventEmitted(withdrawLiquidationResult, liquidationContract, "DisputeSettled", (ev) => {
          return (
            ev.caller == contractDeployer &&
            ev.sponsor == sponsor &&
            ev.liquidator == liquidator &&
            ev.disputer == disputer &&
            ev.liquidationId == 0 &&
            ev.disputeSucceeded
          );
        });

        const expectedPayoutToDisputer = disputeBond.add(disputerDisputeReward).add(finalFeeAmount);
        const expectedPayoutToLiquidator = amountOfSynthetic.sub(disputerDisputeReward).sub(sponsorDisputeReward);
        const expectedPayoutToSponsor = sponsorDisputeReward.add(amountOfCollateral.sub(amountOfSynthetic));
        await assertEventEmitted(withdrawLiquidationResult, liquidationContract, "LiquidationWithdrawn", (ev) => {
          return (
            ev.caller === contractDeployer &&
            ev.paidToLiquidator.toString() === expectedPayoutToLiquidator.toString() &&
            ev.paidToSponsor.toString() === expectedPayoutToSponsor.toString() &&
            ev.paidToDisputer.toString() === expectedPayoutToDisputer.toString() &&
            ev.liquidationStatus.toString() === LiquidationStatesEnum.DISPUTE_SUCCEEDED &&
            ev.settlementPrice.toString() === disputePrice
          );
        });
      });
    });

    describe("Withdraw: Liquidation is pending a dispute but price has not resolved", () => {
      beforeEach(async () => {
        // Dispute a liquidation
        await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
      });
      it("Fails even if liquidation expires", async () => {
        assert(
          await didContractThrow(
            liquidationContract.methods
              .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
              .send({ from: accounts[0] })
          )
        );
        // Expire contract
        await liquidationContract.methods.setCurrentTime(toBN(startTime).add(liquidationLiveness).toString());
        assert(
          await didContractThrow(
            liquidationContract.methods
              .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
              .send({ from: accounts[0] })
          )
        );
      });
    });

    describe("Withdraw: Liquidation expires without dispute (but synthetic token has not expired)", () => {
      beforeEach(async () => {
        // Expire contract
        await liquidationContract.methods
          .setCurrentTime(toBN(startTime).add(liquidationLiveness).toString())
          .send({ from: accounts[0] });
      });
      it("Liquidation does not exist", async () => {
        assert(
          await didContractThrow(
            liquidationContract.methods
              .withdrawLiquidation(liquidationParams.falseLiquidationId, sponsor)
              .send({ from: accounts[0] })
          )
        );
      });
      it("Rewards are distributed", async () => {
        // Check return value.
        const rewardAmounts = await liquidationContract.methods
          .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
          .call();
        assert.equal(rewardAmounts.paidToDisputer.toString(), "0");
        assert.equal(rewardAmounts.paidToSponsor.toString(), "0");
        assert.equal(rewardAmounts.paidToLiquidator.toString(), amountOfCollateral.add(finalFeeAmount).toString());

        const withdrawTxn = await liquidationContract.methods
          .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
          .send({ from: accounts[0] });
        assert.equal(
          (await collateralToken.methods.balanceOf(liquidator).call()).toString(),
          amountOfCollateral.add(finalFeeAmount).toString()
        );

        // Liquidation should be deleted
        const liquidation = await liquidationContract.methods
          .liquidations(sponsor, liquidationParams.liquidationId)
          .call();
        assert.equal(liquidation.state.toString(), LiquidationStatesEnum.UNINITIALIZED);

        // Event is emitted correctly.
        await assertEventEmitted(withdrawTxn, liquidationContract, "LiquidationWithdrawn", (ev) => {
          return (
            ev.caller === contractDeployer &&
            ev.paidToLiquidator.toString() === amountOfCollateral.add(finalFeeAmount).toString() &&
            ev.paidToSponsor.toString() === "0" &&
            ev.paidToDisputer.toString() === "0" &&
            ev.liquidationStatus.toString() === LiquidationStatesEnum.PRE_DISPUTE &&
            ev.settlementPrice.toString() === "0"
          );
        });

        // Creating another liquidation increments the last used liquidation ID:
        // - Open a new position:
        // - Mint collateral to sponsor
        await collateralToken.methods.mint(sponsor, amountOfCollateral).send({ from: contractDeployer });
        // - Set allowance for contract to pull collateral tokens from sponsor
        await collateralToken.methods
          .increaseAllowance(liquidationContract.options.address, amountOfCollateral)
          .send({ from: sponsor });
        // - Create position
        await liquidationContract.methods
          .create({ rawValue: amountOfCollateral.toString() }, { rawValue: amountOfSynthetic.toString() })
          .send({ from: sponsor });
        // - Set allowance for contract to pull synthetic tokens from liquidator
        await syntheticToken.methods
          .increaseAllowance(liquidationContract.options.address, amountOfSynthetic)
          .send({ from: liquidator });
        // - Transfer synthetic tokens to a liquidator
        await syntheticToken.methods.transfer(liquidator, amountOfSynthetic).send({ from: sponsor });

        // Create another liquidation
        const { liquidationId } = await liquidationContract.methods
          .createLiquidation(
            sponsor,
            { rawValue: "0" },
            { rawValue: pricePerToken.toString() },
            { rawValue: amountOfSynthetic.toString() },
            unreachableDeadline
          )
          .call({ from: liquidator });
        await liquidationContract.methods
          .createLiquidation(
            sponsor,
            { rawValue: "0" },
            { rawValue: pricePerToken.toString() },
            { rawValue: amountOfSynthetic.toString() },
            unreachableDeadline
          )
          .send({ from: liquidator });
        assert.equal(liquidationId.toString(), toBN(liquidationParams.liquidationId).addn(1).toString());

        // Cannot withdraw again.
        assert(
          await didContractThrow(
            liquidationContract.methods
              .withdrawLiquidation(liquidationParams.falseLiquidationId, sponsor)
              .send({ from: accounts[0] })
          )
        );
      });
    });

    describe("Withdraw: Liquidation dispute resolves", () => {
      beforeEach(async () => {
        // Dispute
        await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
      });
      describe("Dispute succeeded", () => {
        beforeEach(async () => {
          // Settle the dispute as SUCCESSFUL. for this the liquidation needs to be unsuccessful.
          const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
          const disputePrice = toWei("1");
          await mockOracle.methods
            .pushPrice(priceFeedIdentifier, liquidationTime, disputePrice)
            .send({ from: accounts[0] });
        });
        it("Rewards are transferred to sponsor, liquidator, and disputer", async () => {
          // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
          const expectedSponsorPayment = amountOfCollateral.sub(settlementTRV).add(sponsorDisputeReward);

          // Expected Liquidator payment => TRV - dispute reward - sponsor reward
          const expectedLiquidatorPayment = settlementTRV.sub(disputerDisputeReward).sub(sponsorDisputeReward);

          // Expected Disputer payment => disputer reward + dispute bond + final fee
          const expectedDisputerPayment = disputerDisputeReward.add(disputeBond).add(finalFeeAmount);

          // Check return value.
          const rewardAmounts = await liquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .call();
          assert.equal(rewardAmounts.paidToDisputer.toString(), expectedDisputerPayment.toString());
          assert.equal(rewardAmounts.paidToSponsor.toString(), expectedSponsorPayment.toString());
          assert.equal(rewardAmounts.paidToLiquidator.toString(), expectedLiquidatorPayment.toString());

          await liquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .send({ from: accounts[0] });
          assert.equal(
            (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
            expectedSponsorPayment.toString()
          );
          assert.equal(
            (await collateralToken.methods.balanceOf(liquidator).call()).toString(),
            expectedLiquidatorPayment.toString()
          );
          assert.equal(
            (await collateralToken.methods.balanceOf(disputer).call()).toString(),
            expectedDisputerPayment.toString()
          );
        });
        it("Withdraw still succeeds even if liquidation has expired", async () => {
          // Expire contract
          await liquidationContract.methods.setCurrentTime(toBN(startTime).add(liquidationLiveness).toString());
          await liquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .send({ from: accounts[0] });
        });
        it("Liquidated contact should have no assets remaining after all withdrawals and be deleted", async () => {
          await liquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .send({ from: accounts[0] });
          assert.equal(
            (await collateralToken.methods.balanceOf(liquidationContract.options.address).call()).toString(),
            "0"
          );
          const deletedLiquidation = await liquidationContract.methods
            .liquidations(sponsor, liquidationParams.liquidationId)
            .call();
          assert.equal(deletedLiquidation.liquidator, zeroAddress);
          assert.equal(deletedLiquidation.sponsor, zeroAddress);
          assert.equal(deletedLiquidation.disputer, zeroAddress);
          assert.equal(deletedLiquidation.state.toString(), LiquidationStatesEnum.UNINITIALIZED);
        });
        it("Fees on liquidation", async () => {
          // Charge a 10% fee per second.
          await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.1") }).send({ from: accounts[0] });

          // Advance time to charge fee.
          let currentTime = parseInt(await liquidationContract.methods.getCurrentTime().call());
          await liquidationContract.methods.setCurrentTime(currentTime + 1).send({ from: accounts[0] });

          let startBalanceSponsor = toBN(await collateralToken.methods.balanceOf(sponsor).call());
          let startBalanceLiquidator = toBN(await collateralToken.methods.balanceOf(liquidator).call());
          let startBalanceDisputer = toBN(await collateralToken.methods.balanceOf(disputer).call());

          const sponsorAmount = toWei("49.5");
          // (TOT_COL  - TRV + TS_REWARD   ) * (1 - FEE_PERCENTAGE) = TS_WITHDRAW
          // (150      - 100 + (0.05 * 100)) * (1 - 0.1           ) = 49.5

          const liquidatorAmount = toWei("81");
          // (TRV - TS_REWARD    - DISPUTER_REWARD) * (1 - FEE_PERCENTAGE) = LIQ_WITHDRAW
          // (100 - (0.05 * 100) - (0.05 * 100)   ) * (1 - 0.1           )  = 81.0

          const disputerAmount = toWei("18.9");
          // (BOND        + DISPUTER_REWARD + FINAL_FEE) * (1 - FEE_PERCENTAGE) = DISPUTER_WITHDRAW
          // ((0.1 * 150) + (0.05 * 100)    + 1        ) * (1 - 0.1           ) = 18.9

          // Withdraw liquidation
          const withdrawTxn = await liquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .send({ from: accounts[0] });
          await assertEventEmitted(withdrawTxn, liquidationContract, "LiquidationWithdrawn", (ev) => {
            return (
              ev.paidToLiquidator.toString() === liquidatorAmount &&
              ev.paidToSponsor.toString() === sponsorAmount &&
              ev.paidToDisputer.toString() === disputerAmount &&
              ev.liquidationStatus.toString() === LiquidationStatesEnum.DISPUTE_SUCCEEDED &&
              ev.settlementPrice.toString() === toWei("1")
            );
          });

          // Sponsor balance check.
          assert.equal(
            (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
            startBalanceSponsor.add(toBN(sponsorAmount)).toString()
          );

          // Liquidator balance check.
          assert.equal(
            (await collateralToken.methods.balanceOf(liquidator).call()).toString(),
            startBalanceLiquidator.add(toBN(liquidatorAmount)).toString()
          );

          // Disputer balance check.
          assert.equal(
            (await collateralToken.methods.balanceOf(disputer).call()).toString(),
            startBalanceDisputer.add(toBN(disputerAmount)).toString()
          );

          // Clean up store fees.
          await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" }).send({ from: accounts[0] });
        });
      });
      describe("Dispute failed", () => {
        beforeEach(async () => {
          // Settle the dispute as FAILED. To achieve this the liquidation must be correct.
          const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
          const disputePrice = toWei("1.3");
          await mockOracle.methods
            .pushPrice(priceFeedIdentifier, liquidationTime, disputePrice)
            .send({ from: accounts[0] });
        });
        it("Uses all collateral from liquidation to pay liquidator, and deletes liquidation", async () => {
          // Expected Liquidator payment => lockedCollateral + liquidation.disputeBond % of liquidation.lockedCollateral + final fee refund to liquidator
          const expectedPayment = amountOfCollateral.add(disputeBond).add(finalFeeAmount);
          // Check return value.
          const rewardAmounts = await liquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .call();
          assert.equal(rewardAmounts.paidToDisputer.toString(), "0");
          assert.equal(rewardAmounts.paidToSponsor.toString(), "0");
          assert.equal(rewardAmounts.paidToLiquidator.toString(), expectedPayment.toString());

          await liquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .send({ from: accounts[0] });
          assert.equal(
            (await collateralToken.methods.balanceOf(liquidator).call()).toString(),
            expectedPayment.toString()
          );

          // No collateral left in contract, deletes liquidation.
          assert.equal(
            (await collateralToken.methods.balanceOf(liquidationContract.options.address).call()).toString(),
            "0"
          );
          const deletedLiquidation = await liquidationContract.methods
            .liquidations(sponsor, liquidationParams.liquidationId)
            .call();
          assert.equal(deletedLiquidation.liquidator, zeroAddress);
          assert.equal(deletedLiquidation.state.toString(), LiquidationStatesEnum.UNINITIALIZED);
        });
        it("Withdraw still succeeds even if liquidation has expired", async () => {
          // Expire contract
          await liquidationContract.methods.setCurrentTime(toBN(startTime).add(liquidationLiveness).toString());
          await liquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .send({ from: accounts[0] });
        });
      });
    });
  });

  describe("Weird Edge cases", () => {
    it("Liquidating 0 tokens is not allowed", async () => {
      // Liquidations for 0 tokens should be blocked because the contract prevents 0 liquidated collateral.

      // Create position.
      await liquidationContract.methods
        .create({ rawValue: amountOfCollateral.toString() }, { rawValue: amountOfSynthetic.toString() })
        .send({ from: sponsor });

      // Mint liquidator enough tokens to pay the final fee.
      await collateralToken.methods.mint(liquidator, finalFeeAmount).send({ from: contractDeployer });

      // Liquidator does not need any synthetic tokens to initiate this liquidation.
      assert.equal((await syntheticToken.methods.balanceOf(liquidator).call()).toString(), "0");

      // Request a 0 token liquidation.
      assert(
        await didContractThrow(
          liquidationContract.methods
            .createLiquidation(
              sponsor,
              { rawValue: "0" },
              { rawValue: pricePerToken.toString() },
              { rawValue: "0" },
              unreachableDeadline
            )
            .send({ from: liquidator })
        )
      );
    });
    it("Dispute rewards should not add to over 100% of TRV", async () => {
      // Deploy liquidation contract and set global params.
      // Set the add of the dispute rewards to be >= 100 %
      let invalidConstructorParameter = liquidatableParameters;
      invalidConstructorParameter.sponsorDisputeRewardPercentage = { rawValue: toWei("0.6") };
      invalidConstructorParameter.disputerDisputeRewardPercentage = { rawValue: toWei("0.5") };
      assert(await didContractThrow(Liquidatable.new(invalidConstructorParameter).send({ from: contractDeployer })));
    });
    it("Collateral requirement should be later than 100%", async () => {
      let invalidConstructorParameter = liquidatableParameters;
      invalidConstructorParameter.collateralRequirement = { rawValue: toWei("0.95") };
      assert(await didContractThrow(Liquidatable.new(invalidConstructorParameter).send({ from: contractDeployer })));
    });
    it("Dispute bond can be over 100%", async () => {
      const edgedisputeBondPercentage = toBN(toWei("1.0"));
      const edgeDisputeBond = edgedisputeBondPercentage.mul(amountOfCollateral).div(toBN(toWei("1")));

      // Send away previous balances
      await collateralToken.methods.transfer(contractDeployer, disputeBond).send({ from: disputer });
      await collateralToken.methods.transfer(contractDeployer, amountOfCollateral).send({ from: sponsor });

      // Create  Liquidation
      syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: accounts[0] });
      liquidatableParameters.tokenAddress = syntheticToken.options.address;
      const edgeLiquidationContract = await Liquidatable.new(liquidatableParameters).send({ from: accounts[0] });
      await syntheticToken.methods.addMinter(edgeLiquidationContract.options.address).send({ from: accounts[0] });
      await syntheticToken.methods.addBurner(edgeLiquidationContract.options.address).send({ from: accounts[0] });
      // Get newly created synthetic token
      const edgeSyntheticToken = await Token.at(await edgeLiquidationContract.methods.tokenCurrency().call());
      // Reset start time signifying the beginning of the first liquidation
      await edgeLiquidationContract.methods.setCurrentTime(startTime).send({ from: accounts[0] });
      // Mint collateral to sponsor
      await collateralToken.methods.mint(sponsor, amountOfCollateral).send({ from: contractDeployer });
      // Mint dispute bond to disputer
      await collateralToken.methods.mint(disputer, edgeDisputeBond).send({ from: contractDeployer });
      // Set allowance for contract to pull collateral tokens from sponsor
      await collateralToken.methods
        .increaseAllowance(edgeLiquidationContract.options.address, amountOfCollateral)
        .send({ from: sponsor });
      // Set allowance for contract to pull dispute bond from disputer
      await collateralToken.methods
        .increaseAllowance(edgeLiquidationContract.options.address, edgeDisputeBond)
        .send({ from: disputer });
      // Set allowance for contract to pull synthetic tokens from liquidator
      await edgeSyntheticToken.methods
        .increaseAllowance(edgeLiquidationContract.options.address, amountOfSynthetic)
        .send({ from: liquidator });
      // Create position
      await edgeLiquidationContract.methods
        .create({ rawValue: amountOfCollateral.toString() }, { rawValue: amountOfSynthetic.toString() })
        .send({ from: sponsor });
      // Transfer synthetic tokens to a liquidator
      await edgeSyntheticToken.methods.transfer(liquidator, amountOfSynthetic).send({ from: sponsor });
      // Create a Liquidation
      await edgeLiquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });
      // Dispute
      await edgeLiquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
      // Settle the dispute as SUCCESSFUL
      const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
      await mockOracle.methods
        .pushPrice(priceFeedIdentifier, liquidationTime, settlementPrice.toString())
        .send({ from: accounts[0] });
      await edgeLiquidationContract.methods
        .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
        .send({ from: accounts[0] });
      // Expected Disputer payment => disputer reward + dispute bond
      const expectedPaymentDisputer = disputerDisputeReward.add(edgeDisputeBond).add(finalFeeAmount);
      assert.equal(
        (await collateralToken.methods.balanceOf(disputer).call()).toString(),
        expectedPaymentDisputer.toString()
      );
      // Expected Liquidator payment => TRV - dispute reward - sponsor reward
      const expectedPaymentLiquidator = settlementTRV.sub(disputerDisputeReward).sub(sponsorDisputeReward);
      assert.equal(
        (await collateralToken.methods.balanceOf(liquidator).call()).toString(),
        expectedPaymentLiquidator.toString()
      );
      // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
      const expectedPaymentSponsor = amountOfCollateral.sub(settlementTRV).add(sponsorDisputeReward);
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        expectedPaymentSponsor.toString()
      );
    });
    it("Requested withdrawal amount is equal to the total position collateral, liquidated collateral should be 0", async () => {
      // Create position.
      await liquidationContract.methods
        .create({ rawValue: amountOfCollateral.toString() }, { rawValue: amountOfSynthetic.toString() })
        .send({ from: sponsor });
      // Request withdrawal amount > collateral
      await liquidationContract.methods
        .requestWithdrawal({ rawValue: amountOfCollateral.toString() })
        .send({ from: sponsor });
      // Transfer synthetic tokens to a liquidator
      await syntheticToken.methods.transfer(liquidator, amountOfSynthetic).send({ from: sponsor });
      // Liquidator believes the price of collateral per synthetic to be 1.5 and is liquidating the full token outstanding amount.
      // Therefore, they are intending to liquidate all 150 collateral, {       // however due to the pending withdrawal amount, the liquidated collateral gets reduced to 0.
      const createLiquidationResult = await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });
      const liquidationTime = await liquidationContract.methods.getCurrentTime().call();
      await assertEventEmitted(createLiquidationResult, liquidationContract, "LiquidationCreated", (ev) => {
        return (
          ev.sponsor == sponsor &&
          ev.liquidator == liquidator &&
          ev.liquidationId == liquidationParams.liquidationId &&
          ev.tokensOutstanding == amountOfSynthetic.toString() &&
          ev.lockedCollateral == amountOfCollateral.toString() &&
          ev.liquidatedCollateral == "0" &&
          ev.liquidationTime == liquidationTime.toString()
        );
      });
      // Since the liquidated collateral:synthetic ratio is 0, even the lowest price (amount of collateral each synthetic is worth)
      // above 0 should result in a failed dispute because the liquidator was correct: there is not enough collateral backing the tokens.
      await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
      const disputePrice = "1";
      await mockOracle.methods
        .pushPrice(priceFeedIdentifier, liquidationTime, disputePrice)
        .send({ from: accounts[0] });
      const withdrawLiquidationResult = await liquidationContract.methods
        .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
        .send({ from: accounts[0] });
      // Liquidator should get the full locked collateral.
      const expectedPayment = amountOfCollateral.add(disputeBond);
      await assertEventEmitted(withdrawLiquidationResult, liquidationContract, "LiquidationWithdrawn", (ev) => {
        return (
          ev.caller == contractDeployer &&
          ev.paidToLiquidator.toString() == expectedPayment.toString() &&
          ev.paidToSponsor.toString() == "0" &&
          ev.paidToDisputer.toString() == "0" &&
          ev.liquidationStatus.toString() == LiquidationStatesEnum.DISPUTE_FAILED &&
          ev.settlementPrice.toString() == disputePrice.toString()
        );
      });
    });
  });

  describe("Emergency shutdown", () => {
    it("Liquidations are disabled if emergency shutdown", async () => {
      // Create position.
      await liquidationContract.methods
        .create({ rawValue: amountOfCollateral.toString() }, { rawValue: amountOfSynthetic.toString() })
        .send({ from: sponsor });
      // Transfer synthetic tokens to a liquidator.
      await syntheticToken.methods.transfer(liquidator, amountOfSynthetic).send({ from: sponsor });

      // Advance time until some point during contract life.
      const expirationTime = parseInt(await liquidationContract.methods.expirationTimestamp().call());
      await liquidationContract.methods.setCurrentTime(expirationTime - 1000);

      // Emergency shutdown the priceless position manager via the financialContractsAdmin.
      await financialContractsAdmin.methods
        .callEmergencyShutdown(liquidationContract.options.address)
        .send({ from: accounts[0] });

      // At this point a liquidation should not be able to be created.
      assert(
        await didContractThrow(
          liquidationContract.methods
            .createLiquidation(
              sponsor,
              { rawValue: "0" },
              { rawValue: pricePerToken.toString() },
              { rawValue: amountOfSynthetic.toString() },
              unreachableDeadline
            )
            .send({ from: liquidator })
        )
      );
    });
  });

  describe("Underlying position expires during a pending liquidation", () => {
    let liquidationTime;

    beforeEach(async () => {
      // Fast forward time to right before expiry so that you can still create a liquidation.
      let positionExpiry = await liquidationContract.methods.expirationTimestamp().call();
      await liquidationContract.methods
        .setCurrentTime(toBN(positionExpiry).sub(toBN(1)).toString())
        .send({ from: accounts[0] });
      // Create a new position.
      await liquidationContract.methods
        .create({ rawValue: amountOfCollateral.toString() }, { rawValue: amountOfSynthetic.toString() })
        .send({ from: sponsor });
      // Transfer synthetic tokens to a liquidator
      await syntheticToken.methods.transfer(liquidator, amountOfSynthetic).send({ from: sponsor });
      // Create a Liquidation
      liquidationTime = await liquidationContract.methods.getCurrentTime().call();
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });
      // Fast forward time to expiry.
      await liquidationContract.methods.setCurrentTime(toBN(positionExpiry).toString()).send({ from: accounts[0] });
    });
    it("Can expire the underlying position", async () => {
      const expireResult = await liquidationContract.methods.expire().send({ from: rando });
      await assertEventEmitted(expireResult, liquidationContract, "ContractExpired", (ev) => {
        return ev.caller == rando;
      });
    });
    it("Can dispute the liquidation", async () => {
      await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
      const liquidation = await liquidationContract.methods
        .liquidations(sponsor, liquidationParams.liquidationId)
        .call();
      assert.equal(liquidation.state.toString(), LiquidationStatesEnum.PENDING_DISPUTE);
      assert.equal(liquidation.disputer, disputer);
      assert.equal(liquidation.liquidationTime.toString(), liquidationTime.toString());
    });
    it("Can withdraw liquidation rewards", async () => {
      // Dispute fails, liquidator withdraws, liquidation is deleted
      await liquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
      const disputePrice = toWei("1.3");
      await mockOracle.methods
        .pushPrice(priceFeedIdentifier, liquidationTime, disputePrice)
        .send({ from: accounts[0] });
      await liquidationContract.methods
        .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
        .send({ from: accounts[0] });
      // Expected Liquidator payment => lockedCollateral + liquidation.disputeBond % of liquidation.lockedCollateral to liquidator
      const expectedPayment = amountOfCollateral.add(disputeBond);
      assert.equal((await collateralToken.methods.balanceOf(liquidator).call()).toString(), expectedPayment.toString());
      assert.equal(
        (await collateralToken.methods.balanceOf(liquidationContract.options.address).call()).toString(),
        "0"
      );
    });
  });
  describe("Non-standard ERC20 delimitation", () => {
    // All parameters in this test suite up to now have been scaled by 1e18. To simulate non-standard ERC20
    // token delimitation a new ERC20 is created with a different number of decimals. To simulate two popular
    // stable coins as collateral (USDT & USDC) 6 decimal points are used. First, appropriate parameters used in
    // previous tests are scaled by 1e12 (1000000000000) to represent them in units of the new collateral currency.
    const USDCScalingFactor = toBN("1000000000000"); // 1e12

    // By dividing the pre-defined parameters by the scaling factor 1e12 they are brought down from 1e18 to 1e6
    const USDCAmountOfCollateral = amountOfCollateral.div(USDCScalingFactor); // 150e6
    const USDCAmountOfSynthetic = amountOfSynthetic.div(USDCScalingFactor); // 150e6

    // Next, re-define a number of constants used before in terms of the newly scaled variables
    const USDCSettlementTRV = USDCAmountOfSynthetic.mul(settlementPrice).div(toBN(toWei("1"))); // 100e6
    const USDCSponsorDisputeReward = sponsorDisputeRewardPercentage.mul(USDCSettlementTRV).div(toBN(toWei("1"))); // 5e6
    const USDTDisputerDisputeReward = disputerDisputeRewardPercentage.mul(USDCSettlementTRV).div(toBN(toWei("1"))); // 5e6
    const USDCDisputeBond = disputeBondPercentage.mul(USDCAmountOfCollateral).div(toBN(toWei("1"))); // 15e6

    let USDCLiquidationContract;
    beforeEach(async () => {
      // Start by creating a ERC20 token with different delimitations. 6 decimals for USDC
      collateralToken = await TestnetERC20.new("USDC", "USDC", 6).send({ from: accounts[0] });
      await collateralWhitelist.methods.addToWhitelist(collateralToken.options.address).send({ from: accounts[0] });
      await collateralToken.methods.allocateTo(sponsor, toWei("100")).send({ from: accounts[0] });
      await collateralToken.methods.allocateTo(disputer, toWei("100")).send({ from: accounts[0] });

      syntheticToken = await SyntheticToken.new("USDCETH", "USDCETH", 6).send({ from: accounts[0] });

      // Update the liquidatableParameters to use the new token as collateral and deploy a new Liquidatable contract
      let USDCLiquidatableParameters = liquidatableParameters;
      USDCLiquidatableParameters.collateralAddress = collateralToken.options.address;
      USDCLiquidatableParameters.tokenAddress = syntheticToken.options.address;
      USDCLiquidatableParameters.minSponsorTokens = { rawValue: minSponsorTokens.div(USDCScalingFactor).toString() };
      USDCLiquidationContract = await Liquidatable.new(USDCLiquidatableParameters).send({ from: accounts[0] });

      await syntheticToken.methods.addMinter(USDCLiquidationContract.options.address).send({ from: accounts[0] });
      await syntheticToken.methods.addBurner(USDCLiquidationContract.options.address).send({ from: accounts[0] });

      // Approve the contract to spend the tokens on behalf of the sponsor & liquidator. Simplify this process in a loop
      for (let i = 1; i < 4; i++) {
        await syntheticToken.methods
          .approve(USDCLiquidationContract.options.address, toWei("100000"))
          .send({ from: accounts[i] });
        await collateralToken.methods
          .approve(USDCLiquidationContract.options.address, toWei("100000"))
          .send({ from: accounts[i] });
      }

      // Next, create the position which will be used in the liquidation event. Note that the input amount of collateral
      // is the scaled value defined above as 150e6, representing 150 USDC. the Synthetics created have not changed at
      // a value of 100e18.
      await USDCLiquidationContract.methods
        .create({ rawValue: USDCAmountOfCollateral.toString() }, { rawValue: USDCAmountOfSynthetic.toString() })
        .send({ from: sponsor });
      // Transfer USDCSynthetic tokens to a liquidator
      await syntheticToken.methods.transfer(liquidator, USDCAmountOfSynthetic).send({ from: sponsor });

      // Create a Liquidation which can be tested against.
      await USDCLiquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() }, // Prices should use 18 decimals.
          { rawValue: USDCAmountOfSynthetic.toString() },
          unreachableDeadline
        )
        .send({ from: liquidator });

      // Finally, dispute the liquidation.
      await USDCLiquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
    });
    describe("Dispute succeeded", () => {
      beforeEach(async () => {
        // Settle the dispute as SUCCESSFUL. for this the liquidation needs to be unsuccessful.
        const liquidationTime = await USDCLiquidationContract.methods.getCurrentTime().call();
        await mockOracle.methods
          .pushPrice(priceFeedIdentifier, liquidationTime, settlementPrice.toString())
          .send({ from: accounts[0] });
        // What is tested in the assertions that follow focus specifically on instances whewre in collateral
        // moves around. Other kinds of tests (like revert on Rando calls) are not tested again for brevity
      });
      it("Rewards are distributed", async () => {
        const sponsorUSDCBalanceBefore = toBN(await collateralToken.methods.balanceOf(sponsor).call());
        const disputerUSDCBalanceBefore = toBN(await collateralToken.methods.balanceOf(disputer).call());
        const liquidatorUSDCBalanceBefore = toBN(await collateralToken.methods.balanceOf(liquidator).call());
        await USDCLiquidationContract.methods
          .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
          .send({ from: accounts[0] });
        const sponsorUSDCBalanceAfter = toBN(await collateralToken.methods.balanceOf(sponsor).call());
        const disputerUSDCBalanceAfter = toBN(await collateralToken.methods.balanceOf(disputer).call());
        const liquidatorUSDCBalanceAfter = toBN(await collateralToken.methods.balanceOf(liquidator).call());

        // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
        const expectedPaymentSponsor = USDCAmountOfCollateral.sub(USDCSettlementTRV).add(USDCSponsorDisputeReward);
        assert.equal(
          sponsorUSDCBalanceAfter.sub(sponsorUSDCBalanceBefore).toString(),
          expectedPaymentSponsor.toString()
        );

        // Expected Liquidator payment => TRV - dispute reward - sponsor reward
        const expectedPaymentLiquidator = USDCSettlementTRV.sub(USDTDisputerDisputeReward).sub(
          USDCSponsorDisputeReward
        );
        assert.equal(
          liquidatorUSDCBalanceAfter.sub(liquidatorUSDCBalanceBefore).toString(),
          expectedPaymentLiquidator.toString()
        );

        // Expected Disputer payment => disputer reward + dispute bond
        const expectedPaymentDisputer = USDTDisputerDisputeReward.add(USDCDisputeBond);
        assert.equal(
          disputerUSDCBalanceAfter.sub(disputerUSDCBalanceBefore).toString(),
          expectedPaymentDisputer.toString()
        );

        // Contract should have no collateral remaining.
        assert.equal(
          (await collateralToken.methods.balanceOf(USDCLiquidationContract.options.address).call()).toString(),
          "0"
        );
        const deletedLiquidation = await USDCLiquidationContract.methods
          .liquidations(sponsor, liquidationParams.liquidationId)
          .call();
        assert.equal(deletedLiquidation.liquidator, zeroAddress);
      });
      it("Fees on liquidation", async () => {
        // Charge a 10% fee per second.
        await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.1") }).send({ from: accounts[0] });

        // Advance time to charge fee.
        let currentTime = parseInt(await USDCLiquidationContract.methods.getCurrentTime().call());
        await USDCLiquidationContract.methods.setCurrentTime(currentTime + 1).send({ from: accounts[0] });

        let startBalanceSponsor = toBN(await collateralToken.methods.balanceOf(sponsor).call());
        let startBalanceLiquidator = toBN(await collateralToken.methods.balanceOf(liquidator).call());
        let startBalanceDisputer = toBN(await collateralToken.methods.balanceOf(disputer).call());

        // The logic in the assertions that follows is identical to previous tests except the output
        // is scaled to be represented in USDC.
        const sponsorAmount = toBN(toWei("49.5")).div(USDCScalingFactor);
        // (TOT_COL  - TRV + TS_REWARD   ) * (1 - FEE_PERCENTAGE) = TS_WITHDRAW
        // (150      - 100 + (0.05 * 100)) * (1 - 0.1           ) = 49.5

        const liquidatorAmount = toBN(toWei("81")).div(USDCScalingFactor);
        // (TRV - TS_REWARD    - DISPUTER_REWARD) * (1 - FEE_PERCENTAGE) = LIQ_WITHDRAW
        // (100 - (0.05 * 100) - (0.05 * 100)   ) * (1 - 0.1           )  = 81.0

        const disputerAmount = toBN(toWei("18")).div(USDCScalingFactor);
        // (BOND        + DISPUTER_REWARD) * (1 - FEE_PERCENTAGE) = DISPUTER_WITHDRAW
        // ((0.1 * 150) + (0.05 * 100)    ) * (1 - 0.1           ) = 18.0

        // Withdraw liquidation
        const withdrawTxn = await USDCLiquidationContract.methods
          .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
          .send({ from: accounts[0] });

        await assertEventEmitted(withdrawTxn, USDCLiquidationContract, "LiquidationWithdrawn", (ev) => {
          return (
            ev.paidToLiquidator.toString() === liquidatorAmount.toString() &&
            ev.paidToSponsor.toString() === sponsorAmount.toString() &&
            ev.paidToDisputer.toString() === disputerAmount.toString() &&
            ev.liquidationStatus.toString() === LiquidationStatesEnum.DISPUTE_SUCCEEDED &&
            ev.settlementPrice.toString() === toWei("1")
          );
        });

        // Sponsor balance check.
        assert.equal(
          (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
          startBalanceSponsor.add(sponsorAmount).toString()
        );

        // Liquidator balance check.
        assert.equal(
          (await collateralToken.methods.balanceOf(liquidator).call()).toString(),
          startBalanceLiquidator.add(liquidatorAmount).toString()
        );

        // Disputer balance check.
        assert.equal(
          (await collateralToken.methods.balanceOf(disputer).call()).toString(),
          startBalanceDisputer.add(disputerAmount).toString()
        );

        // Clean up store fees.
        await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" }).send({ from: accounts[0] });
      });
    });
    describe("Dispute failed", () => {
      beforeEach(async () => {
        // Settle the dispute as FAILED. To achieve this the liquidation must be correct.
        const liquidationTime = await USDCLiquidationContract.methods.getCurrentTime().call();
        const disputePrice = toBN(toWei("1.3")); // Prices should always be in 18 decimals.
        await mockOracle.methods
          .pushPrice(priceFeedIdentifier, liquidationTime, disputePrice)
          .send({ from: accounts[0] });
      });
      it("Rewards liquidator only, liquidation is deleted", async () => {
        const liquidatorUSDCBalanceBefore = toBN(await collateralToken.methods.balanceOf(liquidator).call());
        await USDCLiquidationContract.methods
          .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
          .send({ from: accounts[0] });
        const liquidatorUSDCBalanceAfter = toBN(await collateralToken.methods.balanceOf(liquidator).call());
        // Expected Liquidator payment => lockedCollateral + liquidation.disputeBond % of liquidation.lockedCollateral to liquidator
        const expectedPayment = USDCAmountOfCollateral.add(USDCDisputeBond);
        assert.equal(
          liquidatorUSDCBalanceAfter.sub(liquidatorUSDCBalanceBefore).toString(),
          expectedPayment.toString()
        );
        // Liquidator contract should have nothing left in it and all params reset on the liquidation object
        assert.equal(
          (await collateralToken.methods.balanceOf(USDCLiquidationContract.options.address).call()).toString(),
          "0"
        );
        const deletedLiquidation = await USDCLiquidationContract.methods
          .liquidations(sponsor, liquidationParams.liquidationId)
          .call();
        assert.equal(deletedLiquidation.liquidator, zeroAddress);
        assert.equal(deletedLiquidation.state.toString(), LiquidationStatesEnum.UNINITIALIZED);
      });
    });
  });
  describe("Custom Financial Contract Library", () => {
    // All tests up until now have not used a custom financial contract library to preform any kind of transformations
    // against the contract collateralization ratio. In this set of tests we will verify that a financial contract
    // library can apply transformation logic to a contracts collateral requirement & price identifie when performing
    // liquidations/disputed.

    let fclLiquidationContract;
    let financialProductLibraryTest;
    describe("Collateral requirement transformation", () => {
      beforeEach(async () => {
        // Deploy the financial product library.
        financialProductLibraryTest = await FinancialProductLibraryTest.new(
          { rawValue: toWei("1") }, // _priceTransformationScalar. Set to 1 to not adjust the oracle price.
          { rawValue: toWei("2") }, // _collateralRequirementTransformationScalar. Set to 2 to scale the contract CR by 2.
          priceFeedIdentifier // _transformedPriceIdentifier. Set to the original priceFeedIdentifier to apply no transformation.
        ).send({ from: accounts[0] });

        // Create a custom liquidatable object, containing the financialProductLibraryAddress.
        let fclLiquidatableParameters = liquidatableParameters;
        fclLiquidatableParameters.financialProductLibraryAddress = financialProductLibraryTest.options.address;
        fclLiquidationContract = await Liquidatable.new(fclLiquidatableParameters).send({ from: accounts[0] });

        await syntheticToken.methods.addMinter(fclLiquidationContract.options.address).send({ from: accounts[0] });
        await syntheticToken.methods.addBurner(fclLiquidationContract.options.address).send({ from: accounts[0] });

        // Approve the contract to spend the tokens on behalf of the sponsor & liquidator. Simplify this process in a loop.
        for (let i = 1; i < 4; i++) {
          await syntheticToken.methods
            .approve(fclLiquidationContract.options.address, toWei("100000"))
            .send({ from: accounts[i] });
          await collateralToken.methods
            .approve(fclLiquidationContract.options.address, toWei("100000"))
            .send({ from: accounts[i] });
        }

        // Next, create the position which will be used in the liquidation event.
        await fclLiquidationContract.methods
          .create({ rawValue: amountOfCollateral.toString() }, { rawValue: amountOfSynthetic.toString() })
          .send({ from: sponsor });
        // Transfer synthetic tokens to a liquidator.
        await syntheticToken.methods.transfer(liquidator, amountOfSynthetic).send({ from: sponsor });

        // Create a Liquidation which can be tested against.
        await fclLiquidationContract.methods
          .createLiquidation(
            sponsor,
            { rawValue: "0" },
            { rawValue: pricePerToken.toString() }, // Prices should use 18 decimals.
            { rawValue: amountOfSynthetic.toString() },
            unreachableDeadline
          )
          .send({ from: liquidator });

        // Finally, dispute the liquidation.
        await fclLiquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
      });
      it("Call from liquidatable should transform CR requirement", async () => {
        // The price in this call (the parameter) does not matter as this test library simply applies a scaler to the CR.
        assert.equal(
          (
            await fclLiquidationContract.methods.transformCollateralRequirement({ rawValue: toWei("10") }).call()
          ).toString(),
          collateralRequirement.muln(2).toString()
        );
      });
      it("Call to financial product library directly", async () => {
        // Test calling the library directly.
        const financialProductLibrary = await FinancialProductLibraryTest.at(
          await fclLiquidationContract.methods.financialProductLibrary().call()
        );
        assert.equal(
          (
            await financialProductLibrary.methods
              .transformCollateralRequirement(
                { rawValue: toWei("10") }, // price. Again does not matter.
                { rawValue: collateralRequirement.toString() } // input collateralRequirement to transform.
              )
              .call()
          ).toString(),
          collateralRequirement.muln(2).toString()
        );
      });

      describe("Transformation should inform dispute outcome", () => {
        // The sponsor has 100 units of synthetics and 150 units of collateral. Because of the transformation library, {         // the CR requirement of the contract is 1.2 * 2 = 2.4. With this CR requirement, any price larger than 0.625
        // will place the position undercollateralized. Any price below 0.625 will make the position over collateralized.
        // The tests below validate that this transformation was correctly applied to the dispute outcome.

        it("Dispute succeeds", async () => {
          // For the dispute to succeed, the liquidation needs to be invalid. For the liquidation to be invalid, the position
          // should have been correctly collateralized at liquidation time. To achieve this the price should be < 0.625.
          // Pick a value of 0.62. This places the sponsor at a CR of 150/(100*0.62) = 2.419 which is larger than the 2.4 CR.
          const liquidationTime = await fclLiquidationContract.methods.getCurrentTime().call();
          await mockOracle.methods
            .pushPrice(priceFeedIdentifier, liquidationTime, toBN(toWei("0.62")))
            .send({ from: accounts[0] });

          // Withdraw as the liquidator to finailize the dispute.
          const withdrawResult = await fclLiquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .send({ from: liquidator });

          // Verify the dispute succeeded from the event.
          await assertEventEmitted(withdrawResult, fclLiquidationContract, "DisputeSettled", (ev) => {
            return ev.disputeSucceeded; // disputeSuccess should be true.
          });

          await assertEventEmitted(withdrawResult, fclLiquidationContract, "LiquidationWithdrawn", (ev) => {
            return (
              ev.liquidationStatus.toString() == LiquidationStatesEnum.DISPUTE_SUCCEEDED && // liquidationStatus should be DISPUTE_SUCCEEDED.
              ev.settlementPrice.toString() == toBN(toWei("0.62")).toString() // Correct settlement price
            );
          });
        });
        it("Dispute fails", async () => {
          // For the dispute to fail, the liquidation needs to be valid. For the liquidation to be valid, the position
          // should have been incorrectly collateralized at liquidation time. To achieve this the price should be >= 0.625.
          // Pick a value of 0.63. This places the sponsor at a CR of 150/(100*0.63) = 2.38 which is less than the 2.4 CR.
          const liquidationTime = await fclLiquidationContract.methods.getCurrentTime().call();
          await mockOracle.methods
            .pushPrice(priceFeedIdentifier, liquidationTime, toBN(toWei("0.63")))
            .send({ from: accounts[0] });

          // Withdraw as the liquidator to finailize the dispute.
          const withdrawResult = await fclLiquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .send({ from: liquidator });

          // Verify the dispute failed from the event.
          await assertEventEmitted(withdrawResult, fclLiquidationContract, "DisputeSettled", (ev) => {
            return !ev.disputeSucceeded; // disputeSuccess should be false.
          });

          await assertEventEmitted(withdrawResult, fclLiquidationContract, "LiquidationWithdrawn", (ev) => {
            return (
              ev.liquidationStatus.toString() == LiquidationStatesEnum.DISPUTE_FAILED && // liquidationStatus should be DISPUTE_FAILED.
              ev.settlementPrice.toString() == toBN(toWei("0.63")).toString() // Correct settlement price
            );
          });
        });
      });
      describe("Can correctly handle reverting library call", () => {
        beforeEach(async () => {
          await financialProductLibraryTest.methods.setShouldRevert(true).send({ from: accounts[0] });
        });
        it("Test Library reverts correctly", async () => {
          assert.isTrue(await financialProductLibraryTest.methods.shouldRevert().call());
          assert(
            await didContractThrow(
              financialProductLibraryTest.methods
                .transformCollateralRequirement(
                  { rawValue: toWei("10") },
                  { rawValue: collateralRequirement.toString() }
                )
                .send({ from: accounts[0] })
            )
          );
        });
        it("Liquidatable correctly applies no transformation to revetting library call", async () => {
          assert.equal(
            (
              await fclLiquidationContract.methods.transformCollateralRequirement({ rawValue: toWei("10") }).call()
            ).toString(),
            collateralRequirement.toString()
          );
        });
        it("Invalid financial contract library object is handled correctly", async () => {
          // Create a custom liquidatable object, containing the financialProductLibraryAddress but set it to a contract
          // that is not a valid financial product library.
          let brokenFclLiquidatableParameters = liquidatableParameters;
          brokenFclLiquidatableParameters.financialProductLibraryAddress = mockOracle.options.address; // set to something that is not at all a financial contract library to test
          fclLiquidationContract = await Liquidatable.new(brokenFclLiquidatableParameters).send({ from: accounts[0] });

          assert.equal(
            (
              await fclLiquidationContract.methods.transformCollateralRequirement({ rawValue: toWei("10") }).call()
            ).toString(),
            collateralRequirement.toString()
          );
        });
        it("EOA financial contract library object is handled correctly", async () => {
          // Create a custom liquidatable object, containing the financialProductLibraryAddress to an EOA.
          // that is not a valid financial product library.
          let brokenFclLiquidatableParameters = liquidatableParameters;
          brokenFclLiquidatableParameters.financialProductLibraryAddress = rando; // set to EOA.
          fclLiquidationContract = await Liquidatable.new(brokenFclLiquidatableParameters).send({ from: accounts[0] });

          assert.equal(
            (
              await fclLiquidationContract.methods.transformCollateralRequirement({ rawValue: toWei("10") }).call()
            ).toString(),
            collateralRequirement.toString()
          );
        });
      });
    });
    describe("Price identifier transformation", () => {
      const transformedPriceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER_TRANSFORMED");
      beforeEach(async () => {
        // Deploy the financial product library.
        financialProductLibraryTest = await FinancialProductLibraryTest.new(
          { rawValue: toWei("1") }, // _priceTransformationScalar. Set to 1 to not adjust the oracle price.
          { rawValue: toWei("1") }, // _collateralRequirementTransformationScalar. Set to 1 to apply no transformation.
          transformedPriceFeedIdentifier // _transformedPriceIdentifier. Set to the original priceFeedIdentifier to apply no transformation.
        ).send({ from: accounts[0] });

        // Register the transformed price identifier with the identifier whitelist.
        identifierWhitelist = await IdentifierWhitelist.deployed();
        await identifierWhitelist.methods
          .addSupportedIdentifier(transformedPriceFeedIdentifier)
          .send({ from: contractDeployer });

        // Create a custom liquidatable object, containing the financialProductLibraryAddress.
        let fclLiquidatableParameters = liquidatableParameters;
        fclLiquidatableParameters.financialProductLibraryAddress = financialProductLibraryTest.options.address;
        fclLiquidationContract = await Liquidatable.new(fclLiquidatableParameters).send({ from: accounts[0] });

        await syntheticToken.methods.addMinter(fclLiquidationContract.options.address).send({ from: accounts[0] });
        await syntheticToken.methods.addBurner(fclLiquidationContract.options.address).send({ from: accounts[0] });

        // Approve the contract to spend the tokens on behalf of the sponsor & liquidator. Simplify this process in a loop.
        for (let i = 1; i < 4; i++) {
          await syntheticToken.methods
            .approve(fclLiquidationContract.options.address, toWei("100000"))
            .send({ from: accounts[i] });
          await collateralToken.methods
            .approve(fclLiquidationContract.options.address, toWei("100000"))
            .send({ from: accounts[i] });
        }

        // Next, create the position which will be used in the liquidation event.
        await fclLiquidationContract.methods
          .create({ rawValue: amountOfCollateral.toString() }, { rawValue: amountOfSynthetic.toString() })
          .send({ from: sponsor });
        // Transfer synthetic tokens to a liquidator.
        await syntheticToken.methods.transfer(liquidator, amountOfSynthetic).send({ from: sponsor });

        // Create a Liquidation which can be tested against.
        await fclLiquidationContract.methods
          .createLiquidation(
            sponsor,
            { rawValue: "0" },
            { rawValue: pricePerToken.toString() }, // Prices should use 18 decimals.
            { rawValue: amountOfSynthetic.toString() },
            unreachableDeadline
          )
          .send({ from: liquidator });

        // Finally, dispute the liquidation.
        await fclLiquidationContract.methods.dispute(liquidationParams.liquidationId, sponsor).send({ from: disputer });
      });

      it("Dispute should have enquired transformed price request", async () => {
        // Check that the enquire price request with the DVM is for the transformed price identifier.
        const priceRequestStatus = await mockOracle.methods.getPendingQueries().call();
        assert.equal(priceRequestStatus.length, 1); // there should be only one request
        assert.equal(hexToUtf8(priceRequestStatus[0].identifier), hexToUtf8(transformedPriceFeedIdentifier)); // the requested identifier should be transformed
      });

      describe("transformed identifier should be used correctly in dispute outcome", () => {
        it("Dispute succeeds", async () => {
          // For the dispute to succeed, the liquidation needs to be invalid. For the liquidation to be invalid, the position
          // should have been correctly collateralized at liquidation time. To achieve this the price should be < 1.25.
          // Pick a value of 1.24. This places the sponsor at a CR of 150/(100*1.24) = 1.2096 which is larger than the 1.2 CR.
          const liquidationTime = await fclLiquidationContract.methods.getCurrentTime().call();
          await mockOracle.methods
            .pushPrice(transformedPriceFeedIdentifier, liquidationTime, toBN(toWei("1.24")))
            .send({ from: accounts[0] });

          // Withdraw as the liquidator to finailize the dispute.
          const withdrawResult = await fclLiquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .send({ from: liquidator });

          // Verify the dispute succeeded from the event.
          await assertEventEmitted(withdrawResult, fclLiquidationContract, "DisputeSettled", (ev) => {
            return ev.disputeSucceeded; // disputeSuccess should be true.
          });

          await assertEventEmitted(withdrawResult, fclLiquidationContract, "LiquidationWithdrawn", (ev) => {
            return (
              ev.liquidationStatus.toString() == LiquidationStatesEnum.DISPUTE_SUCCEEDED && // liquidationStatus should be DISPUTE_SUCCEEDED.
              ev.settlementPrice.toString() == toBN(toWei("1.24")).toString() // Correct settlement price
            );
          });
        });
        it("Dispute fails", async () => {
          // For the dispute to fail, the liquidation needs to be valid. For the liquidation to be valid, the position
          // should have been incorrectly collateralized at liquidation time. To achieve this the price should be >= 1.25.
          // Pick a value of 1.26. This places the sponsor at a CR of 150/(100*1.26) = 1.19 which is less than the 1.2 CR.
          const liquidationTime = await fclLiquidationContract.methods.getCurrentTime().call();
          await mockOracle.methods
            .pushPrice(transformedPriceFeedIdentifier, liquidationTime, toBN(toWei("1.26")))
            .send({ from: accounts[0] });

          // Withdraw as the liquidator to finailize the dispute.
          const withdrawResult = await fclLiquidationContract.methods
            .withdrawLiquidation(liquidationParams.liquidationId, sponsor)
            .send({ from: liquidator });

          // Verify the dispute failed from the event.
          await assertEventEmitted(withdrawResult, fclLiquidationContract, "DisputeSettled", (ev) => {
            return !ev.disputeSucceeded; // disputeSuccess should be false.
          });

          await assertEventEmitted(withdrawResult, fclLiquidationContract, "LiquidationWithdrawn", (ev) => {
            return (
              ev.liquidationStatus.toString() == LiquidationStatesEnum.DISPUTE_FAILED && // liquidationStatus should be DISPUTE_FAILED.
              ev.settlementPrice.toString() == toBN(toWei("1.26")).toString() // Correct settlement price
            );
          });
        });
      });
    });
  });
  describe("Precision loss is handled as expected", () => {
    beforeEach(async () => {
      // Deploy a new Liquidation contract with no minimum sponsor token size.
      syntheticToken = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: accounts[0] });
      liquidatableParameters.tokenAddress = syntheticToken.options.address;
      liquidatableParameters.minSponsorTokens = { rawValue: "0" };
      liquidationContract = await Liquidatable.new(liquidatableParameters).send({ from: accounts[0] });
      await syntheticToken.methods.addMinter(liquidationContract.options.address).send({ from: accounts[0] });
      await syntheticToken.methods.addBurner(liquidationContract.options.address).send({ from: accounts[0] });

      // Create a new position with:
      // - 30 collateral
      // - 20 synthetic tokens (10 held by token holder, 10 by sponsor)
      await collateralToken.methods.approve(liquidationContract.options.address, "100000").send({ from: sponsor });
      const numTokens = "20";
      const amountCollateral = "30";
      await liquidationContract.methods
        .create({ rawValue: amountCollateral }, { rawValue: numTokens })
        .send({ from: sponsor });
      await syntheticToken.methods.approve(liquidationContract.options.address, numTokens).send({ from: sponsor });

      // Setting the regular fee to 4 % per second will result in a miscalculated cumulativeFeeMultiplier after 1 second
      // because of the intermediate calculation in `payRegularFees()` for calculating the `feeAdjustment`: ( fees paid ) / (total collateral)
      // = 0.033... repeating, which cannot be represented precisely by a fixed point.
      // --> 0.04 * 30 wei = 1.2 wei, which gets truncated to 1 wei, so 1 wei of fees are paid
      const regularFee = toWei("0.04");
      await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: regularFee }).send({ from: accounts[0] });

      // Advance the contract one second and make the contract pay its regular fees
      let startTime = parseInt(await liquidationContract.methods.getCurrentTime().call());
      await liquidationContract.methods.setCurrentTime(startTime + 1).send({ from: accounts[0] });
      await liquidationContract.methods.payRegularFees().send({ from: accounts[0] });

      // Set the store fees back to 0 to prevent fee multiplier from changing for remainder of the test.
      await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" }).send({ from: accounts[0] });

      // Set allowance for contract to pull synthetic tokens from liquidator
      await syntheticToken.methods
        .increaseAllowance(liquidationContract.options.address, numTokens)
        .send({ from: liquidator });
      await syntheticToken.methods.transfer(liquidator, numTokens).send({ from: sponsor });

      // Create a liquidation.
      await liquidationContract.methods
        .createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: toWei("1.5") },
          { rawValue: numTokens },
          unreachableDeadline
        )
        .send({ from: liquidator });
    });
    it("Fee multiplier is set properly with precision loss, and fees are paid as expected.", async () => {
      // Absent any rounding errors, `getCollateral` should return (initial-collateral - final-fees) = 30 wei - 1 wei = 29 wei.
      // But, because of the use of mul and div in payRegularFees(), getCollateral() will return slightly less
      // collateral than expected. When calculating the new `feeAdjustment`, we need to calculate the %: (fees paid / pfc), which is
      // 1/30. However, 1/30 = 0.03333... repeating, which cannot be represented in FixedPoint. Normally div() would floor
      // this value to 0.033....33, but divCeil sets this to 0.033...34. A higher `feeAdjustment` causes a lower `adjustment` and ultimately
      // lower `totalPositionCollateral` and `positionAdjustment` values.
      let collateralAmount = await liquidationContract.methods.getCollateral(sponsor).call();
      assert.isTrue(toBN(collateralAmount.rawValue).lt(toBN("29")));
      assert.equal(
        (await liquidationContract.methods.cumulativeFeeMultiplier().call()).toString(),
        toWei("0.966666666666666666").toString()
      );

      // The actual amount of fees paid to the store is as expected = 1 wei.
      // At this point, the store should have +1 wei, the contract should have 29 wei but the position will show 28 wei
      // because `(30 * 0.966666666666666666 = 28.999...98)`. `30` is the rawCollateral and if the fee multiplier were correct, {       // then `rawLiquidationCollateral` would be `(30 * 0.966666666666666666...) = 29`.
      // `rawTotalPositionCollateral` is decreased after `createLiquidation()` is called.
      assert.equal(
        (await collateralToken.methods.balanceOf(liquidationContract.options.address).call()).toString(),
        "29"
      );
      assert.equal((await liquidationContract.methods.rawLiquidationCollateral().call()).toString(), "28");
      assert.equal((await liquidationContract.methods.rawTotalPositionCollateral().call()).toString(), "0");
    });
    it("Liquidation object is set up properly", async () => {
      let liquidationData = await liquidationContract.methods.liquidations(sponsor, 0).call();

      // The contract should own 29 collateral but show locked collateral in the liquidation as 28, using the same calculation
      // as `totalPositionCollateral` which is `rawTotalPositionCollateral` from the liquidated position multiplied by the fee multiplier.
      // There was no withdrawal request pending so the liquidated collateral should be 28 as well.
      assert.equal(liquidationData.tokensOutstanding.toString(), "20");
      assert.equal(liquidationData.lockedCollateral.toString(), "28");
      assert.equal(liquidationData.liquidatedCollateral.toString(), "28");

      // The available collateral for rewards is determined by multiplying the locked collateral by a `feeAttentuation` which is
      // (feeMultiplier * liquidationData.rawUnitCollateral), where rawUnitCollateral is (1 / feeMultiplier). So, if no fees have been
      // charged between the calling of `createLiquidation` and `withdrawLiquidation`, the available collateral will be equal to the
      // locked collateral.
      // - rawUnitCollateral = (1 / 0.966666666666666666) = 1.034482758620689655
      assert.equal(fromWei(liquidationData.rawUnitCollateral.toString()), "1.034482758620689655");
    });
    it("withdrawLiquidation() returns the same amount of collateral that liquidationCollateral is decreased by", async () => {
      // So, the available collateral for rewards should be (lockedCollateral * feeAttenuation), {       // where feeAttenuation is (rawUnitCollateral * feeMultiplier) = 1.034482758620689655 * 0.966666666666666666 = 0.999999999999999999.
      // This will compute in incorrect value for the lockedCollateral available for rewards, therefore rawUnitCollateral
      // will decrease by less than its full lockedCollateral. The contract should transfer to the liquidator the same amount.

      // First, expire the liquidation
      let startTime = await liquidationContract.methods.getCurrentTime().call();
      await liquidationContract.methods
        .setCurrentTime(toBN(startTime).add(liquidationLiveness).toString())
        .send({ from: accounts[0] });

      // The liquidator is owed (0.999999999999999999 * 28 = 27.9999...) which gets truncated to 27.
      // The contract should have 29 - 27 = 2 collateral remaining, and the liquidation should be deleted.
      const rewardAmounts = await liquidationContract.methods.withdrawLiquidation(0, sponsor).call();
      assert.equal(rewardAmounts.paidToLiquidator.toString(), "27");

      await liquidationContract.methods.withdrawLiquidation(0, sponsor).send({ from: accounts[0] });
      assert.equal((await collateralToken.methods.balanceOf(liquidator).call()).toString(), "27");
      assert.equal(
        (await collateralToken.methods.balanceOf(liquidationContract.options.address).call()).toString(),
        "2"
      );
      let deletedLiquidationData = await liquidationContract.methods.liquidations(sponsor, 0).call();
      assert.equal(deletedLiquidationData.state.toString(), LiquidationStatesEnum.UNINITIALIZED);

      // rawLiquidationCollateral should also have been decreased by 27, from 28 to 1
      assert.equal((await liquidationContract.methods.rawLiquidationCollateral().call()).toString(), "1");
    });
  });
});
