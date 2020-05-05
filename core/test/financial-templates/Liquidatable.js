// Helper scripts
const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const { LiquidationStatesEnum } = require("../../../common/Enums");
const { interfaceName } = require("../../utils/Constants.js");
const { MAX_UINT_VAL } = require("../../../common/Constants.js");
const truffleAssert = require("truffle-assertions");
const { toWei, fromWei, hexToUtf8, toBN } = web3.utils;

// Helper Contracts
const Token = artifacts.require("ExpandedERC20");
const TestnetERC20 = artifacts.require("TestnetERC20");

// Contracts to unit test
const Liquidatable = artifacts.require("Liquidatable");

// Other UMA related contracts and mocks
const Store = artifacts.require("Store");
const Finder = artifacts.require("Finder");
const MockOracle = artifacts.require("MockOracle");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const Timer = artifacts.require("Timer");

contract("Liquidatable", function(accounts) {
  // Roles
  const contractDeployer = accounts[0];
  const sponsor = accounts[1];
  const liquidator = accounts[2];
  const disputer = accounts[3];
  const rando = accounts[4];
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
  const disputeBondPct = toBN(toWei("0.1"));
  const disputeBond = disputeBondPct.mul(amountOfCollateral).div(toBN(toWei("1")));
  const collateralRequirement = toBN(toWei("1.2"));
  const sponsorDisputeRewardPct = toBN(toWei("0.05"));
  const sponsorDisputeReward = sponsorDisputeRewardPct.mul(settlementTRV).div(toBN(toWei("1")));
  const disputerDisputeRewardPct = toBN(toWei("0.05"));
  const disputerDisputeReward = disputerDisputeRewardPct.mul(settlementTRV).div(toBN(toWei("1")));
  const liquidationLiveness = toBN(60)
    .muln(60)
    .muln(3); // In seconds
  const startTime = "15798990420";
  const minSponsorTokens = toBN(toWei("1"));

  // Synthetic Token Position contract params
  const positionLiveness = toBN(60 * 60).mul(liquidationLiveness); // Add this to liquidation liveness so we can create more positions post-liquidation
  const expirationTimestamp = toBN(startTime)
    .add(positionLiveness)
    .toString();
  const withdrawalLiveness = toBN(60)
    .muln(60)
    .muln(1);
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
  let mockOracle;
  let finder;
  let liquidatableParameters;
  let store;
  let financialContractsAdmin;

  // Basic liquidation params
  const liquidationParams = {
    liquidationId: 0,
    falseLiquidationId: 123456789,
    tokensOutstanding: amountOfSynthetic,
    lockedCollateral: amountOfCollateral,
    liquidatedCollateral: amountOfCollateralToLiquidate
  };

  beforeEach(async () => {
    // Force each test to start with a simulated time that's synced to the startTimestamp.
    const timer = await Timer.deployed();
    await timer.setCurrentTime(startTime);

    // Create Collateral and Synthetic ERC20's
    collateralToken = await Token.new("UMA", "UMA", 18, { from: contractDeployer });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    priceFeedIdentifier = web3.utils.utf8ToHex("ETHUSD");
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier, {
      from: contractDeployer
    });

    // Create a mockOracle and get the deployed finder. Register the mockMoracle with the finder.
    finder = await Finder.deployed();
    mockOracle = await MockOracle.new(finder.address, Timer.address, {
      from: contractDeployer
    });

    const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address, {
      from: contractDeployer
    });

    liquidatableParameters = {
      expirationTimestamp: expirationTimestamp,
      withdrawalLiveness: withdrawalLiveness.toString(),
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: priceFeedIdentifier,
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMAETH",
      liquidationLiveness: liquidationLiveness.toString(),
      collateralRequirement: { rawValue: collateralRequirement.toString() },
      disputeBondPct: { rawValue: disputeBondPct.toString() },
      sponsorDisputeRewardPct: { rawValue: sponsorDisputeRewardPct.toString() },
      disputerDisputeRewardPct: { rawValue: disputerDisputeRewardPct.toString() },
      minSponsorTokens: { rawValue: minSponsorTokens.toString() },
      timerAddress: Timer.address
    };

    // Deploy liquidation contract and set global params
    liquidationContract = await Liquidatable.new(liquidatableParameters, { from: contractDeployer });

    // Get newly created synthetic token
    syntheticToken = await Token.at(await liquidationContract.tokenCurrency());

    // Reset start time signifying the beginning of the first liquidation
    await liquidationContract.setCurrentTime(startTime);

    // Mint collateral to sponsor
    await collateralToken.addMember(1, contractDeployer, { from: contractDeployer });
    await collateralToken.mint(sponsor, amountOfCollateral, { from: contractDeployer });

    // Mint dispute bond to disputer
    await collateralToken.mint(disputer, disputeBond.add(finalFeeAmount), { from: contractDeployer });

    // Set allowance for contract to pull collateral tokens from sponsor
    await collateralToken.increaseAllowance(liquidationContract.address, amountOfCollateral, { from: sponsor });

    // Set allowance for contract to pull dispute bond and final fee from disputer
    await collateralToken.increaseAllowance(liquidationContract.address, disputeBond.add(finalFeeAmount), {
      from: disputer
    });

    // Set allowance for contract to pull the final fee from the liquidator
    await collateralToken.increaseAllowance(liquidationContract.address, finalFeeAmount, { from: liquidator });

    // Set allowance for contract to pull synthetic tokens from liquidator
    await syntheticToken.increaseAllowance(liquidationContract.address, amountOfSynthetic, { from: liquidator });

    // Get store
    store = await Store.deployed();

    // Get financialContractsAdmin
    financialContractsAdmin = await FinancialContractsAdmin.deployed();
  });

  describe("Attempting to liquidate a position that does not exist", () => {
    it("should revert", async () => {
      assert(
        await didContractThrow(
          liquidationContract.createLiquidation(
            sponsor,
            { rawValue: "0" },
            { rawValue: pricePerToken.toString() },
            { rawValue: amountOfSynthetic.toString() },
            unreachableDeadline,
            { from: liquidator }
          )
        )
      );
    });
  });

  describe("Creating a liquidation on a valid position", () => {
    beforeEach(async () => {
      // Create position
      await liquidationContract.create(
        { rawValue: amountOfCollateral.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: sponsor }
      );
      // Transfer synthetic tokens to a liquidator
      await syntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });
    });
    it("Liquidator does not have enough tokens to retire position", async () => {
      await syntheticToken.transfer(contractDeployer, toWei("1"), { from: liquidator });
      assert(
        await didContractThrow(
          liquidationContract.createLiquidation(
            sponsor,
            { rawValue: "0" },
            { rawValue: pricePerToken.toString() },
            { rawValue: amountOfSynthetic.toString() },
            unreachableDeadline,
            { from: liquidator }
          )
        )
      );
    });
    it("Liquidation is mined after the deadline", async () => {
      const currentTime = await liquidationContract.getCurrentTime();
      assert(
        await didContractThrow(
          liquidationContract.createLiquidation(
            sponsor,
            { rawValue: "0" },
            { rawValue: pricePerToken.toString() },
            { rawValue: amountOfSynthetic.toString() },
            currentTime.subn(1).toString(),
            { from: liquidator }
          )
        )
      );
    });
    it("Liquidation is mined before the deadline", async () => {
      const currentTime = await liquidationContract.getCurrentTime();
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        currentTime.addn(1).toString(),
        { from: liquidator }
      );
    });
    it("Collateralization is out of bounds", async () => {
      assert(
        await didContractThrow(
          liquidationContract.createLiquidation(
            sponsor,
            { rawValue: "0" },
            // The `maxCollateralPerToken` is below the actual collateral per token, so the liquidate call should fail.
            { rawValue: pricePerToken.subn(1).toString() },
            { rawValue: amountOfSynthetic.toString() },
            unreachableDeadline,
            { from: liquidator }
          )
        )
      );
      assert(
        await didContractThrow(
          liquidationContract.createLiquidation(
            sponsor,
            // The `minCollateralPerToken` is above the actual collateral per token, so the liquidate call should fail.
            { rawValue: pricePerToken.addn(1).toString() },
            { rawValue: pricePerToken.addn(2).toString() },
            { rawValue: amountOfSynthetic.toString() },
            unreachableDeadline,
            { from: liquidator }
          )
        )
      );
    });
    it("Returns correct ID", async () => {
      const { liquidationId } = await liquidationContract.createLiquidation.call(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      assert.equal(liquidationId.toString(), liquidationParams.liquidationId.toString());
    });
    it("Pulls correct token amount", async () => {
      const { tokensLiquidated } = await liquidationContract.createLiquidation.call(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );

      // Should return the correct number of tokens.
      assert.equal(tokensLiquidated.toString(), amountOfSynthetic.toString());

      const intitialBalance = await syntheticToken.balanceOf(liquidator);
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );

      // Synthetic balance decrease should equal amountOfSynthetic.
      assert.equal(intitialBalance.sub(await syntheticToken.balanceOf(liquidator)), amountOfSynthetic.toString());
    });
    it("Liquidator pays final fee", async () => {
      // Mint liquidator enough tokens to pay the final fee.
      await collateralToken.mint(liquidator, finalFeeAmount, { from: contractDeployer });

      // Set final fee.
      await store.setFinalFee(collateralToken.address, { rawValue: finalFeeAmount.toString() });

      const { finalFeeBond } = await liquidationContract.createLiquidation.call(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      // Should return the correct final fee amount.
      assert.equal(finalFeeBond.toString(), finalFeeAmount.toString());

      const intitialBalance = await collateralToken.balanceOf(liquidator);
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );

      // Collateral balance change should equal the final fee.
      assert.equal(
        intitialBalance.sub(await collateralToken.balanceOf(liquidator)).toString(),
        finalFeeAmount.toString()
      );

      // Reset final fee to 0.
      await store.setFinalFee(collateralToken.address, { rawValue: "0" });
    });
    it("Emits an event", async () => {
      const createLiquidationResult = await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      truffleAssert.eventEmitted(createLiquidationResult, "LiquidationCreated", ev => {
        return (
          ev.sponsor == sponsor,
          ev.liquidator == liquidator,
          ev.liquidationId == 0,
          ev.tokensOutstanding == amountOfSynthetic.toString(),
          ev.lockedCollateral == amountOfCollateral.toString(),
          ev.liquidatedCollateral == amountOfCollateral.toString()
        );
      });
      truffleAssert.eventEmitted(createLiquidationResult, "EndedSponsorPosition", ev => {
        return ev.sponsor == sponsor;
      });
    });
    it("Increments ID after creation", async () => {
      // Create first liquidation
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );

      // Open a new position:
      // - Mint collateral to sponsor
      await collateralToken.mint(sponsor, amountOfCollateral, { from: contractDeployer });
      // - Set allowance for contract to pull collateral tokens from sponsor
      await collateralToken.increaseAllowance(liquidationContract.address, amountOfCollateral, { from: sponsor });
      // - Create position
      await liquidationContract.create(
        { rawValue: amountOfCollateral.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: sponsor }
      );
      // - Set allowance for contract to pull synthetic tokens from liquidator
      await syntheticToken.increaseAllowance(liquidationContract.address, amountOfSynthetic, { from: liquidator });
      // - Transfer synthetic tokens to a liquidator
      await syntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });

      // Create second liquidation
      const { liquidationId } = await liquidationContract.createLiquidation.call(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      assert.equal(
        liquidationId.toString(),
        toBN(liquidationParams.liquidationId)
          .addn(1)
          .toString()
      );
    });
    it("Partial liquidation", async () => {
      // Request a withdrawal.
      const withdrawalAmount = amountOfSynthetic.divn(5);
      await liquidationContract.requestWithdrawal({ rawValue: withdrawalAmount.toString() }, { from: sponsor });

      // Position starts out with `amountOfSynthetic` tokens.
      const expectedLiquidatedTokens = amountOfSynthetic.divn(5);
      const expectedRemainingTokens = amountOfSynthetic.sub(expectedLiquidatedTokens);

      // Position starts out with `amountOfCollateral` collateral.
      const expectedLockedCollateral = amountOfCollateral.divn(5);
      const expectedRemainingCollateral = amountOfCollateral.sub(expectedLockedCollateral);
      const expectedRemainingWithdrawalRequest = withdrawalAmount.sub(withdrawalAmount.divn(5));

      // Create partial liquidation.
      let { liquidationId, tokensLiquidated } = await liquidationContract.createLiquidation.call(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.divn(5).toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.divn(5).toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      let position = await liquidationContract.positions(sponsor);
      let liquidation = await liquidationContract.liquidations(sponsor, liquidationId);
      assert.equal(expectedRemainingTokens.toString(), position.tokensOutstanding.toString());
      assert.equal(expectedRemainingWithdrawalRequest.toString(), position.withdrawalRequestAmount.toString());
      assert.equal(
        expectedRemainingCollateral.toString(),
        (await liquidationContract.getCollateral(sponsor)).toString()
      );
      assert.equal(expectedLiquidatedTokens.toString(), liquidation.tokensOutstanding.toString());
      assert.equal(expectedLockedCollateral.toString(), liquidation.lockedCollateral.toString());
      assert.equal(expectedLiquidatedTokens.toString(), tokensLiquidated.toString());

      // A independent and identical liquidation can be created.
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        // Due to rounding problems, have to increase the pricePerToken.
        { rawValue: pricePerToken.muln(2).toString() },
        { rawValue: amountOfSynthetic.divn(5).toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      ({ liquidationId } = await liquidationContract.createLiquidation.call(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.divn(5).toString() },
        unreachableDeadline,
        { from: liquidator }
      ));
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.divn(5).toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      liquidation = await liquidationContract.liquidations(sponsor, liquidationId);
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
          liquidationContract.createLiquidation(
            sponsor,
            { rawValue: "0" },
            { rawValue: pricePerToken.muln(2).toString() },
            { rawValue: liquidationAmount.toString() },
            unreachableDeadline,
            { from: liquidator }
          )
        )
      );
    });
  });

  describe("Full liquidation has been created", () => {
    // Used to catch events.
    let liquidationResult;

    beforeEach(async () => {
      // Create position
      await liquidationContract.create(
        { rawValue: amountOfCollateral.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: sponsor }
      );

      // Set final fee before initiating the liquidation.
      await store.setFinalFee(collateralToken.address, { rawValue: finalFeeAmount.toString() });

      // Transfer synthetic tokens to a liquidator
      await syntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });

      // Mint a single collateral token for the liquidator.
      await collateralToken.mint(liquidator, finalFeeAmount, { from: contractDeployer });

      // Create a Liquidation
      liquidationTime = await liquidationContract.getCurrentTime();
      liquidationResult = await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );

      // Reset final fee to 0.
      await store.setFinalFee(collateralToken.address, { rawValue: "0" });
    });

    describe("Get a Liquidation", () => {
      it("Liquidator burned synthetic tokens", async () => {
        assert.equal((await syntheticToken.balanceOf(liquidator)).toString(), "0");
        assert.equal((await syntheticToken.totalSupply()).toString(), "0");
      });
      it("Liquidation decrease underlying token debt and collateral", async () => {
        const totalPositionCollateralAfter = await liquidationContract.totalPositionCollateral();
        assert.equal(totalPositionCollateralAfter.rawValue, 0);
        const totalTokensOutstandingAfter = await liquidationContract.totalTokensOutstanding();
        assert.equal(totalTokensOutstandingAfter.toNumber(), 0);
      });
      it("Liquidation exists and params are set properly", async () => {
        const newLiquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
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
        truffleAssert.eventEmitted(liquidationResult, "EndedSponsorPosition", ev => {
          return ev.sponsor == sponsor;
        });
      });
      it("Liquidation does not exist", async () => {
        assert(await didContractThrow(liquidationContract.liquidations(sponsor, liquidationParams.falseLiquidationId)));
      });
    });

    describe("Dispute a Liquidation", () => {
      it("Liquidation does not exist", async () => {
        assert(
          await didContractThrow(
            liquidationContract.dispute(liquidationParams.falseLiquidationId, sponsor, { from: disputer })
          )
        );
      });
      it("Liquidation already expired", async () => {
        await liquidationContract.setCurrentTime(
          toBN(startTime)
            .add(liquidationLiveness)
            .toString()
        );
        assert(
          await didContractThrow(
            liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer })
          )
        );
      });
      it("Disputer does not have enough tokens", async () => {
        await collateralToken.transfer(contractDeployer, toWei("1"), { from: disputer });
        assert(
          await didContractThrow(
            liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer })
          )
        );
      });
      it("Request to dispute succeeds and Liquidation params changed correctly", async () => {
        const liquidationTime = await liquidationContract.getCurrentTime();
        await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
        assert.equal((await collateralToken.balanceOf(disputer)).toString(), "0");
        const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
        assert.equal(liquidation.state.toString(), LiquidationStatesEnum.PENDING_DISPUTE);
        assert.equal(liquidation.disputer, disputer);
        assert.equal(liquidation.liquidationTime.toString(), liquidationTime.toString());
      });
      it("Dispute emits an event", async () => {
        const disputeResult = await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, {
          from: disputer
        });
        truffleAssert.eventEmitted(disputeResult, "LiquidationDisputed", ev => {
          return (
            ev.sponsor == sponsor &&
            ev.liquidator == liquidator &&
            ev.disputer == disputer &&
            ev.liquidationId == 0 &&
            ev.disputeBondAmount == toWei("15").toString() // 10% of the collateral as disputeBondPct * amountOfCollateral
          );
        });
      });
      it("Dispute initiates an oracle call", async () => {
        const liquidationTime = await liquidationContract.getCurrentTime();
        await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
        // Oracle should have an enqueued price after calling dispute
        const pendingRequests = await mockOracle.getPendingQueries();
        assert.equal(hexToUtf8(pendingRequests[0]["identifier"]), hexToUtf8(priceFeedIdentifier));
        assert.equal(pendingRequests[0].time, liquidationTime);
      });
      it("Dispute pays a final fee", async () => {
        // Mint final fee amount to disputer
        await collateralToken.mint(disputer, finalFeeAmount, { from: contractDeployer });

        // Returns correct total bond.
        const totalPaid = await liquidationContract.dispute.call(liquidationParams.liquidationId, sponsor, {
          from: disputer
        });
        assert.equal(totalPaid.toString(), disputeBond.add(finalFeeAmount).toString());

        // Check that store's collateral balance increases
        const storeInitialBalance = toBN(await collateralToken.balanceOf(store.address));
        await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
        const storeAfterDisputeBalance = toBN(await collateralToken.balanceOf(store.address));
        assert.equal(storeAfterDisputeBalance.sub(storeInitialBalance).toString(), finalFeeAmount);

        // Check that the contract only has one final fee refund, not two.
        const expectedContractBalance = toBN(amountOfCollateral)
          .add(disputeBond)
          .add(finalFeeAmount);
        assert.equal(
          (await collateralToken.balanceOf(liquidationContract.address)).toString(),
          expectedContractBalance.toString()
        );
      });
      it("Throw if liquidation has already been disputed", async () => {
        // Mint final fee amount to disputer
        await collateralToken.mint(disputer, finalFeeAmount, { from: contractDeployer });

        await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
        // Mint enough tokens to disputer for another dispute bond
        await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });
        await collateralToken.increaseAllowance(liquidationContract.address, disputeBond, { from: disputer });
        assert(
          await didContractThrow(
            liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer })
          )
        );
        assert.equal(
          (await collateralToken.balanceOf(disputer)).toString(),
          disputeBond.add(finalFeeAmount).toString()
        );
      });
      // Weird edge cases, test anyways:
      it("Liquidation already disputed successfully", async () => {
        // Mint final fee amount to disputer
        await collateralToken.mint(disputer, finalFeeAmount, { from: contractDeployer });

        await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });

        // Push to oracle.
        const liquidationTime = await liquidationContract.getCurrentTime();
        await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, settlementPrice.toString());

        // Mint enough tokens to disputer for another dispute bond
        await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });
        assert(
          await didContractThrow(
            liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer })
          )
        );
        assert.equal(
          (await collateralToken.balanceOf(disputer)).toString(),
          disputeBond.add(finalFeeAmount).toString()
        );
      });
      it("Liquidation already disputed unsuccessfully", async () => {
        // Mint final fee amount to disputer
        await collateralToken.mint(disputer, finalFeeAmount, { from: contractDeployer });

        await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });

        // Push to oracle.
        const liquidationTime = await liquidationContract.getCurrentTime();
        await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, settlementPrice.toString());

        // Mint enough tokens to disputer for another dispute bond
        await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });
        assert(
          await didContractThrow(
            liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer })
          )
        );
        assert.equal(
          (await collateralToken.balanceOf(disputer)).toString(),
          disputeBond.add(finalFeeAmount).toString()
        );
      });
    });

    describe("Settle Dispute: there is not pending dispute", () => {
      it("Cannot settle a Liquidation before a dispute request", async () => {
        assert(
          await didContractThrow(liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor))
        );
      });
    });

    describe("Settle Dispute: there is a pending dispute", () => {
      beforeEach(async () => {
        // Mint final fee amount to disputer
        await collateralToken.mint(disputer, finalFeeAmount, { from: contractDeployer });

        // Dispute the created liquidation
        await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
      });
      it("Settlement price set properly", async () => {
        // After the dispute call the oracle is requested a price. As such, push a price into the oracle at that
        // timestamp for the contract price identifer. Check that the value is set correctly for the dispute object.
        const liquidationTime = await liquidationContract.getCurrentTime();
        const disputePrice = toWei("1");
        await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, disputePrice);
        await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, {
          from: liquidator
        });

        const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
        assert.equal(liquidation.settlementPrice.toString(), disputePrice);
      });
      it("Dispute Succeeded", async () => {
        // For a successful dispute the price needs to result in the position being correctly collateralized (to invalidate the
        // liquidation). Any price below 1.25 for a debt of 100 with 150 units of underlying should result in successful dispute.

        const liquidationTime = await liquidationContract.getCurrentTime();
        const disputePrice = toWei("1");
        await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, disputePrice);
        await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, {
          from: liquidator
        });

        const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
        assert.equal(liquidation.state.toString(), LiquidationStatesEnum.DISPUTE_SUCCEEDED);

        // We test that the event is emitted correctly for a successful dispute in a subsequent test.
      });
      it("Dispute Failed", async () => {
        // For a failed dispute the price needs to result in the position being incorrectly collateralized (the liquidation is valid).
        // Any price above 1.25 for a debt of 100 with 150 units of underlying should result in failed dispute and a successful liquidation.

        const liquidationTime = await liquidationContract.getCurrentTime();
        const disputePrice = toWei("1.3");
        await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, disputePrice);
        const withdrawLiquidationResult = await liquidationContract.withdrawLiquidation(
          liquidationParams.liquidationId,
          sponsor,
          {
            from: liquidator
          }
        );

        // Events should show that the dispute failed.
        truffleAssert.eventEmitted(withdrawLiquidationResult, "DisputeSettled", ev => {
          return !ev.disputeSucceeded;
        });
        const expectedPayout = disputeBond.add(liquidationParams.liquidatedCollateral).add(finalFeeAmount);
        // We want to test that the liquidation status is set to "DISPUTE_FAILED", however
        // if the liquidator calls `withdrawLiquidation()` on a failed dispute, it will first `_settle` the contract
        // and set its status to "DISPUTE_FAILED", but they will also withdraw all of the
        // locked collateral in the contract (plus dispute bond), which will "delete" the liquidation and subsequently set
        // its status to "UNINITIALIZED".
        truffleAssert.eventEmitted(withdrawLiquidationResult, "LiquidationWithdrawn", ev => {
          return (
            ev.caller == liquidator &&
            ev.withdrawalAmount.toString() == expectedPayout.toString() &&
            ev.liquidationStatus.toString() == LiquidationStatesEnum.UNINITIALIZED
          );
        });
      });
      it("Event correctly emitted", async () => {
        // Create a successful dispute and check the event is correct.

        const disputeTime = await liquidationContract.getCurrentTime();
        const disputePrice = toWei("1");
        await mockOracle.pushPrice(priceFeedIdentifier, disputeTime, disputePrice);

        const withdrawLiquidationResult = await liquidationContract.withdrawLiquidation(
          liquidationParams.liquidationId,
          sponsor,
          {
            from: disputer
          }
        );

        truffleAssert.eventEmitted(withdrawLiquidationResult, "DisputeSettled", ev => {
          return (
            ev.caller == disputer &&
            ev.sponsor == sponsor &&
            ev.liquidator == liquidator &&
            ev.disputer == disputer &&
            ev.liquidationId == 0 &&
            ev.disputeSucceeded
          );
        });

        const expectedPayout = disputeBond.add(disputerDisputeReward).add(finalFeeAmount);
        truffleAssert.eventEmitted(withdrawLiquidationResult, "LiquidationWithdrawn", ev => {
          return (
            ev.caller == disputer &&
            ev.withdrawalAmount.toString() == expectedPayout.toString() &&
            ev.liquidationStatus.toString() == LiquidationStatesEnum.DISPUTE_SUCCEEDED
          );
        });
      });
    });

    describe("Withdraw: Liquidation is pending a dispute", () => {
      beforeEach(async () => {
        // Dispute a liquidation
        await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
      });
      it("Fails even regardless if liquidation expires", async () => {
        assert(
          await didContractThrow(
            liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator })
          )
        );
        // Expire contract
        await liquidationContract.setCurrentTime(
          toBN(startTime)
            .add(liquidationLiveness)
            .toString()
        );
        assert(
          await didContractThrow(
            liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator })
          )
        );
      });
    });

    describe("Withdraw: Liquidation expires (but synthetic token has not expired)", () => {
      beforeEach(async () => {
        // Expire contract
        await liquidationContract.setCurrentTime(
          toBN(startTime)
            .add(liquidationLiveness)
            .toString()
        );
      });
      it("Liquidation does not exist", async () => {
        assert(
          await didContractThrow(
            liquidationContract.withdrawLiquidation(liquidationParams.falseUuid, sponsor, { from: liquidator })
          )
        );
      });
      it("Sponsor calls", async () => {
        assert(
          await didContractThrow(
            liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor })
          )
        );
      });
      it("Liquidator calls", async () => {
        await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator });
        assert.equal(
          (await collateralToken.balanceOf(liquidator)).toString(),
          amountOfCollateral.add(finalFeeAmount).toString()
        );

        // Liquidation should still technically exist, but its status should get reset.
        const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
        assert.equal(liquidation.state.toString(), LiquidationStatesEnum.UNINITIALIZED);

        // Liquidator should not be able to call multiple times. Only one withdrawal
        assert(
          await didContractThrow(
            liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator })
          )
        );
      });
      it("After liquidator calls, liquidation is deleted and last used index remains the same", async () => {
        // Withdraw from disputed liquidation and delete it
        await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator });
        const deletedLiquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
        assert.equal(deletedLiquidation.liquidator, zeroAddress);

        // Open a new position:
        // - Mint collateral to sponsor
        await collateralToken.mint(sponsor, amountOfCollateral, { from: contractDeployer });
        // - Set allowance for contract to pull collateral tokens from sponsor
        await collateralToken.increaseAllowance(liquidationContract.address, amountOfCollateral, { from: sponsor });
        // - Create position
        await liquidationContract.create(
          { rawValue: amountOfCollateral.toString() },
          { rawValue: amountOfSynthetic.toString() },
          { from: sponsor }
        );
        // - Set allowance for contract to pull synthetic tokens from liquidator
        await syntheticToken.increaseAllowance(liquidationContract.address, amountOfSynthetic, { from: liquidator });
        // - Transfer synthetic tokens to a liquidator
        await syntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });

        // Create another liquidation
        const { liquidationId } = await liquidationContract.createLiquidation.call(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline,
          { from: liquidator }
        );
        await liquidationContract.createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          unreachableDeadline,
          { from: liquidator }
        );
        assert.equal(
          liquidationId.toString(),
          toBN(liquidationParams.liquidationId)
            .addn(1)
            .toString()
        );
      });
      it("Disputer calls", async () => {
        assert(
          await didContractThrow(
            liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer })
          )
        );
      });
      it("Rando calls", async () => {
        assert(
          await didContractThrow(
            liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: rando })
          )
        );
      });
    });

    describe("Withdraw: Liquidation dispute resolves", () => {
      beforeEach(async () => {
        // Dispute
        await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
      });
      describe("Dispute succeeded", () => {
        beforeEach(async () => {
          // Settle the dispute as SUCCESSFUL. for this the liquidation needs to be unsuccessful.
          const liquidationTime = await liquidationContract.getCurrentTime();
          const disputePrice = toWei("1");
          await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, disputePrice);
        });
        it("Sponsor calls", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor });
          // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
          const expectedPayment = amountOfCollateral.sub(settlementTRV).add(sponsorDisputeReward);
          assert.equal((await collateralToken.balanceOf(sponsor)).toString(), expectedPayment.toString());

          // Sponsor should not be able to call again
          assert(
            await didContractThrow(
              liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor })
            )
          );

          // Liquidation should still exist and its status should reflect the dispute result.
          const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
          assert.equal(liquidation.state.toString(), LiquidationStatesEnum.DISPUTE_SUCCEEDED);
          assert.equal(liquidation.sponsor, zeroAddress);
        });
        it("Liquidator calls", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator });
          // Expected Liquidator payment => TRV - dispute reward - sponsor reward
          const expectedPayment = settlementTRV.sub(disputerDisputeReward).sub(sponsorDisputeReward);
          assert.equal((await collateralToken.balanceOf(liquidator)).toString(), expectedPayment.toString());

          // Liquidator should not be able to call again
          assert(
            await didContractThrow(
              liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator })
            )
          );

          // Liquidation should still exist and its status should reflect the dispute result.
          const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
          assert.equal(liquidation.state.toString(), LiquidationStatesEnum.DISPUTE_SUCCEEDED);
          assert.equal(liquidation.liquidator, zeroAddress);
        });
        it("Disputer calls", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer });
          // Expected Disputer payment => disputer reward + dispute bond + final fee
          const expectedPayment = disputerDisputeReward.add(disputeBond).add(finalFeeAmount);
          assert.equal((await collateralToken.balanceOf(disputer)).toString(), expectedPayment.toString());

          // Disputer should not be able to call again
          assert(
            await didContractThrow(
              liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer })
            )
          );

          // Liquidation should still exist and its status should reflect the dispute result.
          const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
          assert.equal(liquidation.state.toString(), LiquidationStatesEnum.DISPUTE_SUCCEEDED);
          assert.equal(liquidation.disputer, zeroAddress);
        });
        it("Rando calls", async () => {
          assert(
            await didContractThrow(
              liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: rando })
            )
          );
        });
        it("Withdraw still succeeds even if Liquidation has expired", async () => {
          // Expire contract
          await liquidationContract.setCurrentTime(
            toBN(startTime)
              .add(liquidationLiveness)
              .toString()
          );
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor });
        });
        it("Liquidated contact should have no assets remaining after all withdrawals and be deleted", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor });
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator });
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer });
          assert.equal((await collateralToken.balanceOf(liquidationContract.address)).toString(), "0");
          const deletedLiquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
          assert.equal(deletedLiquidation.liquidator, zeroAddress);
          assert.equal(deletedLiquidation.sponsor, zeroAddress);
          assert.equal(deletedLiquidation.disputer, zeroAddress);
          assert.equal(deletedLiquidation.state.toString(), LiquidationStatesEnum.UNINITIALIZED);
        });
        it("Event emitted", async () => {
          const withdrawalResult = await liquidationContract.withdrawLiquidation(
            liquidationParams.liquidationId,
            sponsor,
            {
              from: sponsor
            }
          );

          const expectedPayment = amountOfCollateral.sub(settlementTRV).add(sponsorDisputeReward);
          truffleAssert.eventEmitted(withdrawalResult, "LiquidationWithdrawn", ev => {
            return (
              ev.caller == sponsor &&
              ev.withdrawalAmount.toString() == expectedPayment.toString() &&
              ev.liquidationStatus.toString() == LiquidationStatesEnum.DISPUTE_SUCCEEDED
            );
          });
        });
        it("Fees on liquidation", async () => {
          // Charge a 10% fee per second.
          await store.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.1") });

          // Advance time to charge fee.
          let currentTime = await liquidationContract.getCurrentTime();
          await liquidationContract.setCurrentTime(currentTime.addn(1));

          // Withdraw liquidation
          const sponsorAmount = (
            await liquidationContract.withdrawLiquidation.call(liquidationParams.liquidationId, sponsor, {
              from: sponsor
            })
          ).rawValue;
          const liquidatorAmount = (
            await liquidationContract.withdrawLiquidation.call(liquidationParams.liquidationId, sponsor, {
              from: liquidator
            })
          ).rawValue;
          const disputerAmount = (
            await liquidationContract.withdrawLiquidation.call(liquidationParams.liquidationId, sponsor, {
              from: disputer
            })
          ).rawValue;

          // (TOT_COL  - TRV + TS_REWARD   ) * (1 - FEE_PERCENTAGE) = TS_WITHDRAW
          // (150      - 100 + (0.05 * 100)) * (1 - 0.1           ) = 49.5
          assert.equal(sponsorAmount, toWei("49.5"));

          // (TRV - TS_REWARD    - DISPUTER_REWARD) * (1 - FEE_PERCENTAGE) = LIQ_WITHDRAW
          // (100 - (0.05 * 100) - (0.05 * 100)   ) * (1 - 0.1           )  = 81.0
          assert.equal(liquidatorAmount, toWei("81"));

          // (BOND        + DISPUTER_REWARD + FINAL_FEE) * (1 - FEE_PERCENTAGE) = DISPUTER_WITHDRAW
          // ((0.1 * 150) + (0.05 * 100)    + 1        ) * (1 - 0.1           ) = 18.9
          assert.equal(disputerAmount, toWei("18.9"));

          // Sponsor balance check.
          let startBalance = await collateralToken.balanceOf(sponsor);
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor });
          assert.equal(
            (await collateralToken.balanceOf(sponsor)).toString(),
            startBalance.add(toBN(sponsorAmount)).toString()
          );

          // Liquidator balance check.
          startBalance = await collateralToken.balanceOf(liquidator);
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator });
          assert.equal(
            (await collateralToken.balanceOf(liquidator)).toString(),
            startBalance.add(toBN(liquidatorAmount)).toString()
          );

          // Disputer balance check.
          startBalance = await collateralToken.balanceOf(disputer);
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer });
          assert.equal(
            (await collateralToken.balanceOf(disputer)).toString(),
            startBalance.add(toBN(disputerAmount)).toString()
          );

          // Clean up store fees.
          await store.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" });
        });
      });
      describe("Dispute failed", () => {
        beforeEach(async () => {
          // Settle the dispute as FAILED. To achieve this the liquidation must be correct.
          const liquidationTime = await liquidationContract.getCurrentTime();
          const disputePrice = toWei("1.3");
          await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, disputePrice);
        });
        it("Sponsor calls", async () => {
          assert(
            await didContractThrow(
              liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor })
            )
          );
        });
        it("Liquidator calls, liquidation is deleted", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator });
          // Expected Liquidator payment => lockedCollateral + liquidation.disputeBond % of liquidation.lockedCollateral + final fee refund to liquidator
          const expectedPayment = amountOfCollateral.add(disputeBond).add(finalFeeAmount);
          assert.equal((await collateralToken.balanceOf(liquidator)).toString(), expectedPayment.toString());
          assert.equal((await collateralToken.balanceOf(liquidationContract.address)).toString(), "0");
          const deletedLiquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
          assert.equal(deletedLiquidation.liquidator, zeroAddress);
          assert.equal(deletedLiquidation.state.toString(), LiquidationStatesEnum.UNINITIALIZED);
        });
        it("Disputer calls", async () => {
          assert(
            await didContractThrow(
              liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer })
            )
          );
        });
        it("Rando calls", async () => {
          assert(
            await didContractThrow(
              liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: rando })
            )
          );
        });
        it("Withdraw still succeeds even if Liquidation has expired", async () => {
          // Expire contract
          await liquidationContract.setCurrentTime(
            toBN(startTime)
              .add(liquidationLiveness)
              .toString()
          );
          await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator });
        });
        it("Event is correctly emitted", async () => {
          const withdrawLiquidationResult = await liquidationContract.withdrawLiquidation(
            liquidationParams.liquidationId,
            sponsor,
            { from: liquidator }
          );

          const expectedPayment = amountOfCollateral.add(disputeBond).add(finalFeeAmount);
          truffleAssert.eventEmitted(withdrawLiquidationResult, "LiquidationWithdrawn", ev => {
            return (
              ev.caller == liquidator &&
              ev.withdrawalAmount.toString() == expectedPayment.toString() &&
              // State should be uninitialized as the struct has been deleted as a result of the withdrawal.
              // Once a dispute fails and the liquidator withdraws the struct is removed from state.
              ev.liquidationStatus.toString() == LiquidationStatesEnum.UNINITIALIZED
            );
          });
        });
      });
    });
  });

  describe("Weird Edge cases", () => {
    it("Dispute rewards should not add to over 100% of TRV", async () => {
      // Deploy liquidation contract and set global params.
      // Set the add of the dispute rewards to be >= 100 %
      let invalidConstructorParameter = liquidatableParameters;
      invalidConstructorParameter.sponsorDisputeRewardPct = { rawValue: toWei("0.6") };
      invalidConstructorParameter.disputerDisputeRewardPct = { rawValue: toWei("0.5") };
      assert(await didContractThrow(Liquidatable.new(invalidConstructorParameter, { from: contractDeployer })));
    });
    it("Collateral requirement should be later than 100%", async () => {
      let invalidConstructorParameter = liquidatableParameters;
      invalidConstructorParameter.collateralRequirement = { rawValue: toWei("0.95") };
      assert(await didContractThrow(Liquidatable.new(invalidConstructorParameter, { from: contractDeployer })));
    });
    it("Dispute bond can be over 100%", async () => {
      const edgeDisputeBondPct = toBN(toWei("1.0"));
      const edgeDisputeBond = edgeDisputeBondPct.mul(amountOfCollateral).div(toBN(toWei("1")));

      // Send away previous balances
      await collateralToken.transfer(contractDeployer, disputeBond, { from: disputer });
      await collateralToken.transfer(contractDeployer, amountOfCollateral, { from: sponsor });

      // Create  Liquidation
      const edgeLiquidationContract = await Liquidatable.new(liquidatableParameters, { from: contractDeployer });
      // Get newly created synthetic token
      const edgeSyntheticToken = await Token.at(await edgeLiquidationContract.tokenCurrency());
      // Reset start time signifying the beginning of the first liquidation
      await edgeLiquidationContract.setCurrentTime(startTime);
      // Mint collateral to sponsor
      await collateralToken.mint(sponsor, amountOfCollateral, { from: contractDeployer });
      // Mint dispute bond to disputer
      await collateralToken.mint(disputer, edgeDisputeBond, { from: contractDeployer });
      // Set allowance for contract to pull collateral tokens from sponsor
      await collateralToken.increaseAllowance(edgeLiquidationContract.address, amountOfCollateral, { from: sponsor });
      // Set allowance for contract to pull dispute bond from disputer
      await collateralToken.increaseAllowance(edgeLiquidationContract.address, edgeDisputeBond, { from: disputer });
      // Set allowance for contract to pull synthetic tokens from liquidator
      await edgeSyntheticToken.increaseAllowance(edgeLiquidationContract.address, amountOfSynthetic, {
        from: liquidator
      });
      // Create position
      await edgeLiquidationContract.create(
        { rawValue: amountOfCollateral.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: sponsor }
      );
      // Transfer synthetic tokens to a liquidator
      await edgeSyntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });
      // Create a Liquidation
      await edgeLiquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      // Dispute
      await edgeLiquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
      // Settle the dispute as SUCCESSFUL
      const liquidationTime = await liquidationContract.getCurrentTime();
      await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, settlementPrice.toString());
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer });
      // Expected Disputer payment => disputer reward + dispute bond
      const expectedPaymentDisputer = disputerDisputeReward.add(edgeDisputeBond).add(finalFeeAmount);
      assert.equal((await collateralToken.balanceOf(disputer)).toString(), expectedPaymentDisputer.toString());
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator });
      // Expected Liquidator payment => TRV - dispute reward - sponsor reward
      const expectedPaymentLiquidator = settlementTRV.sub(disputerDisputeReward).sub(sponsorDisputeReward);
      assert.equal((await collateralToken.balanceOf(liquidator)).toString(), expectedPaymentLiquidator.toString());
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor });
      // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
      const expectedPaymentSponsor = amountOfCollateral.sub(settlementTRV).add(sponsorDisputeReward);
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), expectedPaymentSponsor.toString());
    });
    it("Requested withdrawal amount is equal to the total position collateral, liquidated collateral should be 0", async () => {
      // Create position.
      await liquidationContract.create(
        { rawValue: amountOfCollateral.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: sponsor }
      );
      // Request withdrawal amount > collateral
      await liquidationContract.requestWithdrawal({ rawValue: amountOfCollateral.toString() }, { from: sponsor });
      // Transfer synthetic tokens to a liquidator
      await syntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });
      // Liquidator believes the price of collateral per synthetic to be 1.5 and is liquidating the full token outstanding amount.
      // Therefore, they are intending to liquidate all 150 collateral,
      // however due to the pending withdrawal amount, the liquidated collateral gets reduced to 0.
      const createLiquidationResult = await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      truffleAssert.eventEmitted(createLiquidationResult, "LiquidationCreated", ev => {
        return (
          ev.sponsor == sponsor,
          ev.liquidator == liquidator,
          ev.liquidationId == 0,
          ev.tokensOutstanding == amountOfSynthetic.toString(),
          ev.lockedCollateral == amountOfCollateral.toString(),
          ev.liquidatedCollateral == "0"
        );
      });
      // Since the liquidated collateral:synthetic ratio is 0, even the lowest price (amount of collateral each synthetic is worth)
      // above 0 should result in a failed dispute because the liquidator was correct: there is not enough collateral backing the tokens.
      await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
      const liquidationTime = await liquidationContract.getCurrentTime();
      const disputePrice = "1";
      await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, disputePrice);
      const withdrawLiquidationResult = await liquidationContract.withdrawLiquidation(
        liquidationParams.liquidationId,
        sponsor,
        { from: liquidator }
      );
      // Liquidator should get the full locked collateral.
      const expectedPayment = amountOfCollateral.add(disputeBond);
      truffleAssert.eventEmitted(withdrawLiquidationResult, "LiquidationWithdrawn", ev => {
        return (
          ev.caller == liquidator &&
          ev.withdrawalAmount.toString() == expectedPayment.toString() &&
          // State should be uninitialized as the struct has been deleted as a result of the withdrawal.
          // Once a dispute fails and the liquidator withdraws the struct is removed from state.
          ev.liquidationStatus.toString() == LiquidationStatesEnum.UNINITIALIZED
        );
      });
    });
  });

  describe("Emergency shutdown", () => {
    it("Liquidations are disabled if emergency shutdown", async () => {
      // Create position.
      await liquidationContract.create(
        { rawValue: amountOfCollateral.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: sponsor }
      );
      // Transfer synthetic tokens to a liquidator.
      await syntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });

      // Advance time until some point during contract life.
      const expirationTime = await liquidationContract.expirationTimestamp();
      await liquidationContract.setCurrentTime(expirationTime.toNumber() - 1000);

      // Emergency shutdown the priceless position manager via the financialContractsAdmin.
      await financialContractsAdmin.callEmergencyShutdown(liquidationContract.address);

      // At this point a liquidation should not be able to be created.
      assert(
        await didContractThrow(
          liquidationContract.createLiquidation(
            sponsor,
            { rawValue: "0" },
            { rawValue: pricePerToken.toString() },
            { rawValue: amountOfSynthetic.toString() },
            unreachableDeadline,
            { from: liquidator }
          )
        )
      );
    });
  });

  describe("Underlying position expires during a pending liquidation", () => {
    beforeEach(async () => {
      // Fast forward time to right before expiry so that you can still create a liquidation.
      let positionExpiry = await liquidationContract.expirationTimestamp();
      await liquidationContract.setCurrentTime(
        toBN(positionExpiry)
          .sub(toBN(1))
          .toString()
      );
      // Create a new position.
      await liquidationContract.create(
        { rawValue: amountOfCollateral.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: sponsor }
      );
      // Transfer synthetic tokens to a liquidator
      await syntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });
      // Create a Liquidation
      liquidationTime = await liquidationContract.getCurrentTime();
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );
      // Fast forward time to expiry.
      await liquidationContract.setCurrentTime(toBN(positionExpiry).toString());
    });
    it("Can expire the underlying position", async () => {
      const expireResult = await liquidationContract.expire({ from: rando });
      truffleAssert.eventEmitted(expireResult, "ContractExpired", ev => {
        return ev.caller == rando;
      });
    });
    it("Can dispute the liquidation", async () => {
      await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
      const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
      assert.equal(liquidation.state.toString(), LiquidationStatesEnum.PENDING_DISPUTE);
      assert.equal(liquidation.disputer, disputer);
      assert.equal(liquidation.liquidationTime.toString(), liquidationTime.toString());
    });
    it("Can withdraw liquidation rewards", async () => {
      // Dispute fails, liquidator withdraws, liquidation is deleted
      await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
      const disputePrice = toWei("1.3");
      await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, disputePrice);
      await liquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator });
      // Expected Liquidator payment => lockedCollateral + liquidation.disputeBond % of liquidation.lockedCollateral to liquidator
      const expectedPayment = amountOfCollateral.add(disputeBond);
      assert.equal((await collateralToken.balanceOf(liquidator)).toString(), expectedPayment.toString());
      assert.equal((await collateralToken.balanceOf(liquidationContract.address)).toString(), "0");
      const deletedLiquidation = await liquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
      assert.equal(deletedLiquidation.liquidator, zeroAddress);
    });
  });
  describe("Non-standard ERC20 delimitation", () => {
    // All parameters in this test suite up to now have been scaled by 1e18. To simulate non-standard ERC20
    // token delimitation a new ERC20 is created with a different number of decimals. To simulate two popular
    // stable coins as collateral (USDT & USDC) 6 decimal points are used. First, appropriate parameters used in
    // previous tests are scaled by 1e12 (1000000000000) to represent them in units of the new collateral currency.
    const USDCScalingFactor = toBN("1000000000000"); // 1e12

    // By dividing the pre-defined parameters by the scaling factor 1e12 they are brought down from 1e18 to 1e6
    const USDCPricePerToken = pricePerToken.div(USDCScalingFactor); // 1.5e6
    const USDCDisputePrice = settlementPrice.div(USDCScalingFactor); // 1.0e6
    const USDCAmountOfCollateral = amountOfCollateral.div(USDCScalingFactor); // 150e6
    // Note: the number of synthetics does not get scaled. This is still the 100e18 as with other tests.

    // Next, re-define a number of constants used before in terms of the newly scaled variables
    const USDCSettlementTRV = amountOfSynthetic.mul(USDCDisputePrice).div(toBN(toWei("1"))); // 100e6
    const USDCSponsorDisputeReward = sponsorDisputeRewardPct.mul(USDCSettlementTRV).div(toBN(toWei("1"))); // 5e6
    const USDTDisputerDisputeReward = disputerDisputeRewardPct.mul(USDCSettlementTRV).div(toBN(toWei("1"))); // 5e6
    const USDCDisputeBond = disputeBondPct.mul(USDCAmountOfCollateral).div(toBN(toWei("1"))); // 15e6
    beforeEach(async () => {
      // Start by creating a ERC20 token with different delimitations. 6 decimals for USDC
      collateralToken = await TestnetERC20.new("USDC", "USDC", 6);
      await collateralToken.allocateTo(sponsor, toWei("100"));
      await collateralToken.allocateTo(disputer, toWei("100"));

      // Update the liquidatableParameters to use the new token as collateral and deploy a new Liquidatable contract
      let USDCLiquidatableParameters = liquidatableParameters;
      USDCLiquidatableParameters.collateralAddress = collateralToken.address;
      USDCLiquidationContract = await Liquidatable.new(USDCLiquidatableParameters, {
        from: contractDeployer
      });

      // Get newly created synthetic token and set it as the global synthetic token.
      syntheticToken = await Token.at(await USDCLiquidationContract.tokenCurrency());

      // Approve the contract to spend the tokens on behalf of the sponsor & liquidator. Simplify this process in a loop
      for (let i = 1; i < 4; i++) {
        await syntheticToken.approve(USDCLiquidationContract.address, toWei("100000"), {
          from: accounts[i]
        });
        await collateralToken.approve(USDCLiquidationContract.address, toWei("100000"), {
          from: accounts[i]
        });
      }

      // Next, create the position which will be used in the liquidation event. Note that the input amount of collateral
      // is the scaled value defined above as 150e6, representing 150 USDC. the Synthetics created have not changed at
      // a value of 100e18.
      await USDCLiquidationContract.create(
        { rawValue: USDCAmountOfCollateral.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: sponsor }
      );
      // Transfer USDCSynthetic tokens to a liquidator
      await syntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });

      // Create a Liquidation which can be tested against.
      await USDCLiquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: USDCPricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        unreachableDeadline,
        { from: liquidator }
      );

      // Finally, dispute the liquidation.
      await USDCLiquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
    });
    describe("Dispute succeeded", () => {
      beforeEach(async () => {
        // Settle the dispute as SUCCESSFUL. for this the liquidation needs to be unsuccessful.
        const liquidationTime = await USDCLiquidationContract.getCurrentTime();
        await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, USDCDisputePrice.toString());
        // What is tested in the assertions that follow focus specifically on instances whewre in collateral
        // moves around. Other kinds of tests (like revert on Rando calls) are not tested again for brevity
      });
      it("Sponsor calls", async () => {
        const sponsorUSDCBalanceBefore = await collateralToken.balanceOf(sponsor);
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor });
        const sponsorUSDCBalanceAfter = await collateralToken.balanceOf(sponsor);

        // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
        const USDCExpectedPayment = USDCAmountOfCollateral.sub(USDCSettlementTRV).add(USDCSponsorDisputeReward);
        assert.equal(sponsorUSDCBalanceAfter.sub(sponsorUSDCBalanceBefore).toString(), USDCExpectedPayment.toString());

        // Sponsor should not be able to call again
        assert(
          await didContractThrow(
            USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor })
          )
        );
      });
      it("Liquidator calls", async () => {
        const liquidatorUSDCBalanceBefore = await collateralToken.balanceOf(liquidator);
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, {
          from: liquidator
        });
        const liquidatorUSDCBalanceAfter = await collateralToken.balanceOf(liquidator);

        // Expected Liquidator payment => TRV - dispute reward - sponsor reward
        const expectedPayment = USDCSettlementTRV.sub(USDTDisputerDisputeReward).sub(USDCSponsorDisputeReward);
        assert.equal(
          liquidatorUSDCBalanceAfter.sub(liquidatorUSDCBalanceBefore).toString(),
          expectedPayment.toString()
        );

        // Liquidator should not be able to call again
        assert(
          await didContractThrow(
            USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator })
          )
        );
      });
      it("Disputer calls", async () => {
        const disputerUSDCBalanceBefore = await collateralToken.balanceOf(disputer);
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer });
        const disputerUSDCBalanceAfter = await collateralToken.balanceOf(disputer);

        // Expected Disputer payment => disputer reward + dispute bond
        const expectedPayment = USDTDisputerDisputeReward.add(USDCDisputeBond);
        assert.equal(disputerUSDCBalanceAfter.sub(disputerUSDCBalanceBefore).toString(), expectedPayment.toString());

        // Disputer should not be able to call again
        assert(
          await didContractThrow(
            USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer })
          )
        );
      });
      it("Liquidated contact should have no assets remaining after all withdrawals and be deleted", async () => {
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor });
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, {
          from: liquidator
        });
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer });
        assert.equal((await collateralToken.balanceOf(USDCLiquidationContract.address)).toString(), "0");
        const deletedLiquidation = await USDCLiquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
        assert.equal(deletedLiquidation.liquidator, zeroAddress);
      });
      it("Fees on liquidation", async () => {
        // Charge a 10% fee per second.
        await store.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.1") });

        // Advance time to charge fee.
        let currentTime = await USDCLiquidationContract.getCurrentTime();
        await USDCLiquidationContract.setCurrentTime(currentTime.addn(1));

        // Withdraw liquidation
        const sponsorAmount = (
          await USDCLiquidationContract.withdrawLiquidation.call(liquidationParams.liquidationId, sponsor, {
            from: sponsor
          })
        ).rawValue;
        const liquidatorAmount = (
          await USDCLiquidationContract.withdrawLiquidation.call(liquidationParams.liquidationId, sponsor, {
            from: liquidator
          })
        ).rawValue;
        const disputerAmount = (
          await USDCLiquidationContract.withdrawLiquidation.call(liquidationParams.liquidationId, sponsor, {
            from: disputer
          })
        ).rawValue;

        // The logic in the assertions that follows is identical to previous testes except the output
        // is scaled to be represented in USDC.

        // (TOT_COL  - TRV + TS_REWARD   ) * (1 - FEE_PERCENTAGE) = TS_WITHDRAW
        // (150      - 100 + (0.05 * 100)) * (1 - 0.1           ) = 49.5
        assert.equal(
          sponsorAmount,
          toBN(toWei("49.5"))
            .div(USDCScalingFactor)
            .toString()
        );

        // (TRV - TS_REWARD    - DISPUTER_REWARD) * (1 - FEE_PERCENTAGE) = LIQ_WITHDRAW
        // (100 - (0.05 * 100) - (0.05 * 100)   ) * (1 - 0.1           )  = 81.0
        assert.equal(
          liquidatorAmount,
          toBN(toWei("81"))
            .div(USDCScalingFactor)
            .toString()
        );

        // (BOND        + DISPUTER_REWARD) * (1 - FEE_PERCENTAGE) = DISPUTER_WITHDRAW
        // ((0.1 * 150) + (0.05 * 100)    ) * (1 - 0.1           ) = 18.0
        assert.equal(
          disputerAmount,
          toBN(toWei("18"))
            .div(USDCScalingFactor)
            .toString()
        );

        // Sponsor balance check.
        let startBalance = await collateralToken.balanceOf(sponsor);
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor });
        assert.equal(
          (await collateralToken.balanceOf(sponsor)).toString(),
          startBalance.add(toBN(sponsorAmount)).toString()
        );

        // Liquidator balance check.
        startBalance = await collateralToken.balanceOf(liquidator);
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, {
          from: liquidator
        });
        assert.equal(
          (await collateralToken.balanceOf(liquidator)).toString(),
          startBalance.add(toBN(liquidatorAmount)).toString()
        );

        // Disputer balance check.
        startBalance = await collateralToken.balanceOf(disputer);
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer });
        assert.equal(
          (await collateralToken.balanceOf(disputer)).toString(),
          startBalance.add(toBN(disputerAmount)).toString()
        );

        // Clean up store fees.
        await store.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" });
      });
    });
    describe("Dispute failed", () => {
      beforeEach(async () => {
        // Settle the dispute as FAILED. To achieve this the liquidation must be correct.
        const liquidationTime = await USDCLiquidationContract.getCurrentTime();
        const disputePrice = toBN(toWei("1.3")).div(USDCScalingFactor);
        await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, disputePrice);
      });
      it("Liquidator calls, liquidation is deleted", async () => {
        const liquidatorUSDCBalanceBefore = await collateralToken.balanceOf(liquidator);
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, {
          from: liquidator
        });
        const liquidatorUSDCBalanceAfter = await collateralToken.balanceOf(liquidator);
        // Expected Liquidator payment => lockedCollateral + liquidation.disputeBond % of liquidation.lockedCollateral to liquidator
        const expectedPayment = USDCAmountOfCollateral.add(USDCDisputeBond);
        assert.equal(
          liquidatorUSDCBalanceAfter.sub(liquidatorUSDCBalanceBefore).toString(),
          expectedPayment.toString()
        );
        // Liquidator contract should have nothing left in it and all params reset on the liquidation object
        assert.equal((await collateralToken.balanceOf(USDCLiquidationContract.address)).toString(), "0");
        const deletedLiquidation = await USDCLiquidationContract.liquidations(sponsor, liquidationParams.liquidationId);
        assert.equal(deletedLiquidation.liquidator, zeroAddress);
        assert.equal(deletedLiquidation.state.toString(), LiquidationStatesEnum.UNINITIALIZED);
      });
    });
  });
  describe("Precision loss is handled as expected", () => {
    let _liquidationContract;
    beforeEach(async () => {
      // Deploy a new Liquidation contract with no minimum sponsor token size.
      liquidatableParameters.minSponsorTokens = { rawValue: "0" };
      _liquidationContract = await Liquidatable.new(liquidatableParameters, { from: contractDeployer });
      syntheticToken = await Token.at(await _liquidationContract.tokenCurrency());

      // Create a new position with:
      // - 30 collateral
      // - 20 synthetic tokens (10 held by token holder, 10 by sponsor)
      await collateralToken.approve(_liquidationContract.address, "100000", { from: sponsor });
      const numTokens = "20";
      const amountCollateral = "30";
      await _liquidationContract.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });
      await syntheticToken.approve(_liquidationContract.address, numTokens, { from: sponsor });

      // Setting the regular fee to 4 % per second will result in a miscalculated cumulativeFeeMultiplier after 1 second
      // because of the intermediate calculation in `payRegularFees()` for calculating the `feeAdjustment`: ( fees paid ) / (total collateral)
      // = 0.033... repeating, which cannot be represented precisely by a fixed point.
      // --> 0.04 * 30 wei = 1.2 wei, which gets truncated to 1 wei, so 1 wei of fees are paid
      const regularFee = toWei("0.04");
      await store.setFixedOracleFeePerSecondPerPfc({ rawValue: regularFee });

      // Advance the contract one second and make the contract pay its regular fees
      let startTime = await _liquidationContract.getCurrentTime();
      await _liquidationContract.setCurrentTime(startTime.addn(1));
      await _liquidationContract.payRegularFees();

      // Set the store fees back to 0 to prevent fee multiplier from changing for remainder of the test.
      await store.setFixedOracleFeePerSecondPerPfc({ rawValue: "0" });

      // Set allowance for contract to pull synthetic tokens from liquidator
      await syntheticToken.increaseAllowance(_liquidationContract.address, numTokens, { from: liquidator });
      await syntheticToken.transfer(liquidator, numTokens, { from: sponsor });

      // Create a liquidation.
      await _liquidationContract.createLiquidation(
        sponsor,
        { rawValue: "0" },
        { rawValue: toWei("1.5") },
        { rawValue: numTokens },
        unreachableDeadline,
        { from: liquidator }
      );
    });
    it("Fee multiplier is set properly with precision loss, and fees are paid as expected.", async () => {
      // Absent any rounding errors, `getCollateral` should return (initial-collateral - final-fees) = 30 wei - 1 wei = 29 wei.
      // But, because of the use of mul and div in payRegularFees(), getCollateral() will return slightly less
      // collateral than expected. When calculating the new `feeAdjustment`, we need to calculate the %: (fees paid / pfc), which is
      // 1/30. However, 1/30 = 0.03333... repeating, which cannot be represented in FixedPoint. Normally div() would floor
      // this value to 0.033....33, but divCeil sets this to 0.033...34. A higher `feeAdjustment` causes a lower `adjustment` and ultimately
      // lower `totalPositionCollateral` and `positionAdjustment` values.
      let collateralAmount = await _liquidationContract.getCollateral(sponsor);
      assert(toBN(collateralAmount.rawValue).lt(toBN("29")));
      assert.equal(
        (await _liquidationContract.cumulativeFeeMultiplier()).toString(),
        toWei("0.966666666666666666").toString()
      );

      // The actual amount of fees paid to the store is as expected = 1 wei.
      // At this point, the store should have +1 wei, the contract should have 29 wei but the position will show 28 wei
      // because `(30 * 0.966666666666666666 = 28.999...98)`. `30` is the rawCollateral and if the fee multiplier were correct,
      // then `rawLiquidationCollateral` would be `(30 * 0.966666666666666666...) = 29`.
      // `rawTotalPositionCollateral` is decreased after `createLiquidation()` is called.
      assert.equal((await collateralToken.balanceOf(_liquidationContract.address)).toString(), "29");
      assert.equal((await _liquidationContract.rawLiquidationCollateral()).toString(), "28");
      assert.equal((await _liquidationContract.rawTotalPositionCollateral()).toString(), "0");
    });
    it("Liquidation object is set up properly", async () => {
      let liquidationData = await _liquidationContract.liquidations(sponsor, 0);

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
      // So, the available collateral for rewards should be (lockedCollateral * feeAttenuation),
      // where feeAttenuation is (rawUnitCollateral * feeMultiplier) = 1.034482758620689655 * 0.966666666666666666 = 0.999999999999999999.
      // This will compute in incorrect value for the lockedCollateral available for rewards, therefore rawUnitCollateral
      // will decrease by less than its full lockedCollateral. The contract should transfer to the liquidator the same amount.

      // First, expire the liquidation
      let startTime = await _liquidationContract.getCurrentTime();
      await _liquidationContract.setCurrentTime(
        toBN(startTime)
          .add(liquidationLiveness)
          .toString()
      );

      // The liquidator is owed (0.999999999999999999 * 28 = 27.9999...) which gets truncated to 27.
      // The contract should have 29 - 27 = 2 collateral remaining, and the liquidation should be deleted.
      await _liquidationContract.withdrawLiquidation(0, sponsor, { from: liquidator });
      assert.equal((await collateralToken.balanceOf(liquidator)).toString(), "27");
      assert.equal((await collateralToken.balanceOf(_liquidationContract.address)).toString(), "2");
      let deletedLiquidationData = await _liquidationContract.liquidations(sponsor, 0);
      assert.equal(deletedLiquidationData.state.toString(), LiquidationStatesEnum.UNINITIALIZED);

      // rawLiquidationCollateral should also have been decreased by 27, from 28 to 1
      assert.equal((await _liquidationContract.rawLiquidationCollateral()).toString(), "1");
    });
  });
});
