// Helper scripts
const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const { LiquidationStatesEnum } = require("../../../common/Enums");
const truffleAssert = require("truffle-assertions");
const { toWei, hexToUtf8, toBN } = web3.utils;

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
    // Create Collateral and Synthetic ERC20's
    collateralToken = await Token.new({ from: contractDeployer });

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    priceFeedIdentifier = web3.utils.utf8ToHex("ETHUSD");
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier, {
      from: contractDeployer
    });

    // Create a mockOracle and get the deployed finder. Register the mockMoracle with the finder.
    mockOracle = await MockOracle.new(identifierWhitelist.address, {
      from: contractDeployer
    });
    finder = await Finder.deployed();

    const mockOracleInterfaceName = web3.utils.utf8ToHex("Oracle");
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address, {
      from: contractDeployer
    });

    liquidatableParameters = {
      isTest: true,
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
      disputerDisputeRewardPct: { rawValue: disputerDisputeRewardPct.toString() }
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
    await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });

    // Set allowance for contract to pull collateral tokens from sponsor
    await collateralToken.increaseAllowance(liquidationContract.address, amountOfCollateral, { from: sponsor });

    // Set allowance for contract to pull dispute bond from disputer
    await collateralToken.increaseAllowance(liquidationContract.address, disputeBond, { from: disputer });

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
            { rawValue: pricePerToken.toString() },
            { rawValue: amountOfSynthetic.toString() },
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
            { rawValue: pricePerToken.toString() },
            { rawValue: amountOfSynthetic.toString() },
            { from: liquidator }
          )
        )
      );
    });
    it("Returns correct ID", async () => {
      const liquidationId = await liquidationContract.createLiquidation.call(
        sponsor,
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: liquidator }
      );
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: liquidator }
      );
      assert.equal(liquidationId.toString(), liquidationParams.liquidationId.toString());
    });
    it("Emits an event", async () => {
      const createLiquidationResult = await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
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
    });
    it("Increments ID after creation", async () => {
      // Create first liquidation
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
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
      const liquidationId = await liquidationContract.createLiquidation.call(
        sponsor,
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: liquidator }
      );
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
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
      let liquidationId = await liquidationContract.createLiquidation.call(
        sponsor,
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.divn(5).toString() },
        { from: liquidator }
      );
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.divn(5).toString() },
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

      // A independent and identical liquidation can be created.
      await liquidationContract.createLiquidation(
        sponsor,
        // Due to rounding problems, have to increase the pricePerToken.
        { rawValue: pricePerToken.muln(2).toString() },
        { rawValue: amountOfSynthetic.divn(5).toString() },
        { from: liquidator }
      );
      liquidationId = await liquidationContract.createLiquidation.call(
        sponsor,
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.divn(5).toString() },
        { from: liquidator }
      );
      await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.divn(5).toString() },
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
  });

  describe("Liquidation has been created", () => {
    beforeEach(async () => {
      // Create position
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
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: liquidator }
      );
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
        const finalFeeAmount = toWei("1");
        // Set final fee to a flat 1 collateral token
        await store.setFinalFee(collateralToken.address, { rawValue: finalFeeAmount });
        // Mint final fee amount to disputer
        await collateralToken.mint(disputer, finalFeeAmount, { from: contractDeployer });
        // Increase allowance for contract to spend disputer's tokens
        await collateralToken.increaseAllowance(liquidationContract.address, finalFeeAmount, { from: disputer });

        // Check that store's collateral balance increases
        const storeInitialBalance = toBN(await collateralToken.balanceOf(store.address));
        await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
        const storeAfterDisputeBalance = toBN(await collateralToken.balanceOf(store.address));
        assert.equal(storeAfterDisputeBalance.sub(storeInitialBalance).toString(), finalFeeAmount);

        // Check that collateral in liquidation contract remains the same
        const expectedContractBalance = toBN(amountOfCollateral).add(disputeBond);
        assert.equal(
          (await collateralToken.balanceOf(liquidationContract.address)).toString(),
          expectedContractBalance.toString()
        );

        // Set the store fees back to 0 to prevent it from affecting other tests.
        await store.setFinalFee(collateralToken.address, { rawValue: "0" });
      });
      it("Throw if liquidation has already been disputed", async () => {
        await liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
        // Mint enough tokens to disputer for another dispute bond
        await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });
        await collateralToken.increaseAllowance(liquidationContract.address, disputeBond, { from: disputer });
        assert(
          await didContractThrow(
            liquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer })
          )
        );
        assert.equal((await collateralToken.balanceOf(disputer)).toString(), disputeBond.toString());
      });
      // Weird edge cases, test anyways:
      it("Liquidation already disputed successfully", async () => {
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
        assert.equal((await collateralToken.balanceOf(disputer)).toString(), disputeBond.toString());
      });
      it("Liquidation already disputed unsuccessfully", async () => {
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
        assert.equal((await collateralToken.balanceOf(disputer)).toString(), disputeBond.toString());
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
          return !ev.DisputeSucceeded;
        });
        const expectedPayout = disputeBond.add(liquidationParams.liquidatedCollateral);
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
            ev.DisputeSucceeded
          );
        });

        const expectedPayout = disputeBond.add(disputerDisputeReward);
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
        assert.equal((await collateralToken.balanceOf(liquidator)).toString(), amountOfCollateral.toString());

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
        const liquidationId = await liquidationContract.createLiquidation.call(
          sponsor,
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
          { from: liquidator }
        );
        await liquidationContract.createLiquidation(
          sponsor,
          { rawValue: pricePerToken.toString() },
          { rawValue: amountOfSynthetic.toString() },
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
          // Expected Disputer payment => disputer reward + dispute bond
          const expectedPayment = disputerDisputeReward.add(disputeBond);
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
          await store.setFixedOracleFeePerSecond({ rawValue: toWei("0.1") });

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

          // (BOND        + DISPUTER_REWARD) * (1 - FEE_PERCENTAGE) = DISPUTER_WITHDRAW
          // ((0.1 * 150) + (0.05 * 100)    ) * (1 - 0.1           ) = 18.0
          assert.equal(disputerAmount, toWei("18"));

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
          await store.setFixedOracleFeePerSecond({ rawValue: "0" });
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
          // Expected Liquidator payment => lockedCollateral + liquidation.disputeBond % of liquidation.lockedCollateral to liquidator
          const expectedPayment = amountOfCollateral.add(disputeBond);
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
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: liquidator }
      );
      // Dispute
      await edgeLiquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
      // Settle the dispute as SUCCESSFUL
      const liquidationTime = await liquidationContract.getCurrentTime();
      await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, settlementPrice.toString());
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer });
      // Expected Disputer payment => disputer reward + dispute bond
      const expectedPaymentDisputer = disputerDisputeReward.add(edgeDisputeBond);
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
    it("Requested withdrawal amount is greater than total position collateral, liquidated collateral should be 0", async () => {
      // Create position.
      await liquidationContract.create(
        { rawValue: amountOfCollateral.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: sponsor }
      );
      // Request withdrawal amount > collateral
      await liquidationContract.requestWithdrawal(
        { rawValue: amountOfCollateral.add(toBN("1")).toString() },
        { from: sponsor }
      );
      // Transfer synthetic tokens to a liquidator
      await syntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });
      // Liquidator believes the price of collateral per synthetic to be 1.5 and is liquidating the full token outstanding amount.
      // Therefore, they are intending to liquidate all 150 collateral,
      // however due to the pending withdrawal amount, the liquidated collateral gets reduced to 0.
      const createLiquidationResult = await liquidationContract.createLiquidation(
        sponsor,
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
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
            { rawValue: pricePerToken.toString() },
            { rawValue: amountOfSynthetic.toString() },
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
        { rawValue: pricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
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
    // All parameters to in this test suite up to now have been scaled by 1e18. To simulate non-standard ERC20
    // token delimitation a new ERC20 is created with a different number of decimals. Appropriate parameters used in
    // previous tests are scaled by 1e12 (1000000000000) to represent them in units of the new collateral currency.
    const USDCScalingFactor = toBN("1000000000000");
    const USDCPricePerToken = pricePerToken.div(USDCScalingFactor) // 1.5e6
    const USDCDisputePrice = settlementPrice.div(USDCScalingFactor); // 1.0e6
    const USDCAmountOfCollateral = amountOfCollateral.div(USDCScalingFactor); // 150e6

    // We can also re-define a number of constants used before, such as settlementTRV & sponsor dispute reword
    const USDTSettlementTRV = amountOfSynthetic.mul(USDCDisputePrice).div(toBN(toWei("1"))); // 100e6
    const USDTSponsorDisputeReward = sponsorDisputeRewardPct.mul(USDTSettlementTRV).div(toBN(toWei("1"))); // 5e6

    beforeEach(async () => {
      // Start by creating a ERC20 token with different delimitations. 6 decimals for USDC
      collateralToken = await TestnetERC20.new("USDC", "USDC", 6);
      await collateralToken.allocateTo(sponsor, toWei("100"));
      await collateralToken.allocateTo(disputer, toWei("100"));

      // update the liquidatableParameters to use the new token as collateral
      let USDCLiquidatableParameters = liquidatableParameters;
      USDCLiquidatableParameters.collateralAddress = collateralToken.address;

      // Create  Liquidation contract to test against
      USDCLiquidationContract = await Liquidatable.new(USDCLiquidatableParameters, {
        from: contractDeployer
      });
      // Get newly created synthetic token
      sntheticToken = await Token.at(await USDCLiquidationContract.tokenCurrency());

      // First, approve the contract to spend the tokens on behalf of the sponsor & liquidator.
      await collateralToken.approve(USDCLiquidationContract.address, toWei("100000"), {
        from: sponsor
      });
      await sntheticToken.approve(USDCLiquidationContract.address, toWei("100000"), {
        from: sponsor
      });
      await collateralToken.approve(USDCLiquidationContract.address, toWei("100000"), {
        from: liquidator
      });
      await sntheticToken.approve(USDCLiquidationContract.address, toWei("100000"), {
        from: liquidator
      });

      await collateralToken.approve(USDCLiquidationContract.address, toWei("100000"), {
        from: disputer
      });
      await sntheticToken.approve(USDCLiquidationContract.address, toWei("100000"), {
        from: disputer
      });

      // Next, create the position which will be used in the liquidation event. The amount of USDC
      // collateral is 1e12 times less than used in previous tests. This division drops the number of
      // decimals from 18 to 6 in amountOfCollateral.
      await USDCLiquidationContract.create(
        { rawValue: USDCAmountOfCollateral.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: sponsor }
      );
      // Transfer USDCSynthetic tokens to a liquidator
      await sntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });

      // Create a Liquidation
      await USDCLiquidationContract.createLiquidation(
        sponsor,
        { rawValue: USDCPricePerToken.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: liquidator }
      );

      await USDCLiquidationContract.dispute(liquidationParams.liquidationId, sponsor, { from: disputer });
    });
    describe("Dispute succeeded", () => {
      beforeEach(async () => {
        // Settle the dispute as SUCCESSFUL. for this the liquidation needs to be unsuccessful.
        const liquidationTime = await USDCLiquidationContract.getCurrentTime();
        console.log("second before each time", liquidationTime.toString());
        await mockOracle.pushPrice(priceFeedIdentifier, liquidationTime, USDCDisputePrice.toString());

        // Set time to after the liquidation to enable dispute
        await USDCLiquidationContract.setCurrentTime(
          toBN(liquidationTime)
            .add(liquidationLiveness)
            .addn(1)
            .toString()
        );
      });
      it.only("Sponsor calls", async () => {
        // capture balance change from withdrawal
        const sponsorUSDTBalanceBefore = await collateralToken.balanceOf(sponsor);
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor });
        const sponsorUSDTBalanceAfter = await collateralToken.balanceOf(sponsor);

        // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
        const USDTExpectedPayment = USDCAmountOfCollateral.sub(USDTSettlementTRV).add(USDTSponsorDisputeReward);
        assert.equal(sponsorUSDTBalanceAfter.sub(sponsorUSDTBalanceBefore).toString(), USDTExpectedPayment.toString());

        // Sponsor should not be able to call again
        assert(
          await didContractThrow(
            USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor })
          )
        );
      });
      it("Liquidator calls", async () => {
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, {
          from: liquidator
        });
        // Expected Liquidator payment => TRV - dispute reward - sponsor reward
        const expectedPayment = settlementTRV.sub(disputerDisputeReward).sub(sponsorDisputeReward);
        assert.equal((await collateralToken.balanceOf(liquidator)).toString(), expectedPayment.toString());

        // Liquidator should not be able to call again
        assert(
          await didContractThrow(
            USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: liquidator })
          )
        );
      });
      it("Disputer calls", async () => {
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer });
        // Expected Disputer payment => disputer reward + dispute bond
        const expectedPayment = disputerDisputeReward.add(disputeBond);
        assert.equal((await collateralToken.balanceOf(disputer)).toString(), expectedPayment.toString());

        // Disputer should not be able to call again
        assert(
          await didContractThrow(
            USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: disputer })
          )
        );
      });
      it("Rando calls", async () => {
        assert(
          await didContractThrow(
            USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: rando })
          )
        );
      });
      it("Withdraw still succeeds even if Liquidation has expired", async () => {
        // Expire contract
        await USDCLiquidationContract.setCurrentTime(
          toBN(startTime)
            .add(liquidationLiveness)
            .toString()
        );
        await USDCLiquidationContract.withdrawLiquidation(liquidationParams.liquidationId, sponsor, { from: sponsor });
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
      it("Event emitted", async () => {
        const withdrawalResult = await USDCLiquidationContract.withdrawLiquidation(
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
            ev.liquidationStatus.toString() == STATES.DISPUTE_SUCCEEDED
          );
        });
      });
      it("Fees on liquidation", async () => {
        // Charge a 10% fee per second.
        await store.setFixedOracleFeePerSecond({ rawValue: toWei("0.1") });

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

        // (TOT_COL  - TRV + TS_REWARD   ) * (1 - FEE_PERCENTAGE) = TS_WITHDRAW
        // (150      - 100 + (0.05 * 100)) * (1 - 0.1           ) = 49.5
        assert.equal(sponsorAmount, toWei("49.5"));

        // (TRV - TS_REWARD    - DISPUTER_REWARD) * (1 - FEE_PERCENTAGE) = LIQ_WITHDRAW
        // (100 - (0.05 * 100) - (0.05 * 100)   ) * (1 - 0.1           )  = 81.0
        assert.equal(liquidatorAmount, toWei("81"));

        // (BOND        + DISPUTER_REWARD) * (1 - FEE_PERCENTAGE) = DISPUTER_WITHDRAW
        // ((0.1 * 150) + (0.05 * 100)    ) * (1 - 0.1           ) = 18.0
        assert.equal(disputerAmount, toWei("18"));

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
        await store.setFixedOracleFeePerSecond({ rawValue: "0" });
      });
    });
  });
});
