// Helper scripts
const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const BN = require("bignumber.js");
const { toWei } = web3.utils;

// Helper Contracts
const ERC20MintableData = require("@openzeppelin/contracts/build/contracts/ERC20Mintable.json");
const truffleContract = require("@truffle/contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

// Contracts to unit test:
const Liquidatable = artifacts.require("Liquidatable");

contract("Liquidatable", function(accounts) {
  // Roles
  const contractDeployer = accounts[0];
  const sponsor = accounts[1];
  const liquidator = accounts[2];
  const disputer = accounts[3];
  const rando = accounts[4];
  const zeroAddress = "0x0000000000000000000000000000000000000000";

  // Amount of tokens to mint for test
  const amountOfCollateral = BN(toWei("150"));
  const amountOfSynthetic = BN(toWei("100"));

  // Settlement price
  const settlementPrice = BN(toWei("1"));

  // Settlement TRV
  const settlementTRV = amountOfSynthetic.times(settlementPrice).dividedBy(toWei("1"));

  // Liquidation contract params
  const disputeBondPct = BN(toWei("0.1"));
  const disputeBond = disputeBondPct.times(amountOfCollateral).dividedBy(toWei("1"));
  const sponsorDisputeRewardPct = BN(toWei("0.05"));
  const sponsorDisputeReward = sponsorDisputeRewardPct.times(settlementTRV).dividedBy(toWei("1"));
  const disputerDisputeRewardPct = BN(toWei("0.05"));
  const disputerDisputeReward = disputerDisputeRewardPct.times(settlementTRV).dividedBy(toWei("1"));
  const liquidationLiveness = BN(60)
    .times(60)
    .times(3); // In seconds
  const startTime = "15798990420";

  // Synthetic Token Position contract params
  const positionLiveness = BN(60)
    .times(60)
    .times(1)
    .plus(liquidationLiveness); // Add this to liquidation liveness so we can create more positions post-liquidation
  const withdrawalLiveness = BN(60)
    .times(60)
    .times(1);
  const pendingWithdrawalAmount = "0"; // Amount to liquidate can be less than amount of collateral iff there is a pending withdrawal
  const amountOfCollateralToLiquidate = amountOfCollateral.plus(pendingWithdrawalAmount);

  // Contracts
  let liquidationContract;
  let collateralToken;
  let syntheticToken;

  // Basic liquidation params
  const liquidationParams = {
    uuid: 0,
    falseUuid: 123456789,
    tokensOutstanding: amountOfSynthetic,
    lockedCollateral: amountOfCollateral,
    liquidatedCollateral: amountOfCollateralToLiquidate
  };

  // States for Liquidation to be in
  const STATES = {
    PRE_DISPUTE: "0",
    PENDING_DISPUTE: "1",
    DISPUTE_SUCCEEDED: "2",
    DISPUTE_FAILED: "3"
  };

  beforeEach(async () => {
    // Create Collateral and Synthetic ERC20's
    collateralToken = await ERC20Mintable.new({ from: contractDeployer });

    // Deploy liquidation contract and set global params
    liquidationContract = await Liquidatable.new(
      true,
      BN(startTime)
        .plus(positionLiveness)
        .toString(),
      withdrawalLiveness.toString(),
      collateralToken.address,
      { rawValue: disputeBondPct.toString() },
      { rawValue: sponsorDisputeRewardPct.toString() },
      { rawValue: disputerDisputeRewardPct.toString() },
      liquidationLiveness.toString(),
      { from: contractDeployer }
    );

    // Get newly created synthetic token
    syntheticToken = await ERC20Mintable.at(await liquidationContract.tokenCurrency());

    // Reset start time signifying the beginning of the first liquidation
    await liquidationContract.setCurrentTime(startTime);

    // Mint collateral to sponsor
    await collateralToken.mint(sponsor, amountOfCollateral, { from: contractDeployer });

    // Mint dispute bond to disputer
    await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });

    // Set allowance for contract to pull collateral tokens from sponsor
    await collateralToken.increaseAllowance(liquidationContract.address, amountOfCollateral, { from: sponsor });

    // Set allowance for contract to pull dispute bond from disputer
    await collateralToken.increaseAllowance(liquidationContract.address, disputeBond, { from: disputer });

    // Set allowance for contract to pull synthetic tokens from liquidator
    await syntheticToken.increaseAllowance(liquidationContract.address, amountOfSynthetic, { from: liquidator });
  });

  describe("Attempting to liquidate a position that does not exist", () => {
    it("should revert", async () => {
      assert(await didContractThrow(liquidationContract.createLiquidation(sponsor, { from: liquidator })));
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
      assert(await didContractThrow(liquidationContract.createLiquidation(sponsor, { from: liquidator })));
    });
    it("Returns correct UUID", async () => {
      const uuid = await liquidationContract.createLiquidation.call(sponsor, { from: liquidator });
      await liquidationContract.createLiquidation(sponsor, { from: liquidator });
      assert.equal(uuid.toString(), liquidationParams.uuid.toString());
    });
    it("Increments UUID after creation", async () => {
      // Create first liquidation
      await liquidationContract.createLiquidation(sponsor, { from: liquidator });

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
      const uuid = await liquidationContract.createLiquidation.call(sponsor, { from: liquidator });
      await liquidationContract.createLiquidation(sponsor, { from: liquidator });
      assert.equal(
        uuid.toString(),
        BN(liquidationParams.uuid)
          .plus(1)
          .toString()
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
      await liquidationContract.createLiquidation(sponsor, { from: liquidator });
    });

    describe("Get a Liquidation", () => {
      it("Liquidator burned synthetic tokens", async () => {
        assert.equal((await syntheticToken.balanceOf(liquidator)).toString(), "0");
        assert.equal((await syntheticToken.totalSupply()).toString(), "0");
      });
      it("Liquidation exists and params are set properly", async () => {
        const newLiquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
        assert.equal(newLiquidation.state.toString(), STATES.PRE_DISPUTE);
        assert.equal(newLiquidation.tokensOutstanding.toString(), liquidationParams.tokensOutstanding.toString());
        assert.equal(newLiquidation.lockedCollateral.toString(), liquidationParams.lockedCollateral.toString());
        assert.equal(newLiquidation.liquidatedCollateral.toString(), liquidationParams.liquidatedCollateral.toString());
        assert.equal(
          newLiquidation.expiry.toString(),
          BN(startTime)
            .plus(liquidationLiveness)
            .toString()
        );
        assert.equal(newLiquidation.liquidator, liquidator);
        assert.equal(newLiquidation.disputer, zeroAddress);
        assert.equal(newLiquidation.disputeTime.toString(), "0");
        assert.equal(newLiquidation.settlementPrice.toString(), "0");
      });
      it("Liquidation does not exist", async () => {
        const uncreatedLiquidation = await liquidationContract.liquidations(sponsor, liquidationParams.falseUuid);
        assert.equal(uncreatedLiquidation.state.toString(), STATES.PRE_DISPUTE);
        assert.equal(uncreatedLiquidation.liquidator, zeroAddress);
        assert.equal(uncreatedLiquidation.tokensOutstanding.toString(), "0");
        assert.equal(uncreatedLiquidation.lockedCollateral.toString(), "0");
        assert.equal(uncreatedLiquidation.liquidatedCollateral.toString(), "0");
        assert.equal(uncreatedLiquidation.expiry.toString(), "0");
        assert.equal(uncreatedLiquidation.disputer, zeroAddress);
        assert.equal(uncreatedLiquidation.disputeTime.toString(), "0");
        assert.equal(uncreatedLiquidation.settlementPrice.toString(), "0");
      });
    });

    describe("Dispute a Liquidation", () => {
      it("Liquidation does not exist", async () => {
        assert(
          await didContractThrow(liquidationContract.dispute(liquidationParams.falseUuid, sponsor, { from: disputer }))
        );
      });
      it("Liquidation already expired", async () => {
        await liquidationContract.setCurrentTime(
          BN(startTime)
            .plus(liquidationLiveness)
            .toString()
        );
        assert(
          await didContractThrow(liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer }))
        );
      });
      it("Disputer does not have enough tokens", async () => {
        await collateralToken.transfer(contractDeployer, toWei("1"), { from: disputer });
        assert(
          await didContractThrow(liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer }))
        );
      });
      it("Request to dispute succeeds and Liquidation params changed correctly", async () => {
        const disputeTime = await liquidationContract.getCurrentTime();
        await liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
        assert.equal((await collateralToken.balanceOf(disputer)).toString(), "0");
        const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
        assert.equal(liquidation.state.toString(), STATES.PENDING_DISPUTE);
        assert.equal(liquidation.disputer, disputer);
        assert.equal(liquidation.disputeTime.toString(), disputeTime.toString());
      });
      it("Liquidation has already been disputed", async () => {
        await liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
        // Mint enough tokens to disputer for another dispute bond
        await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });
        await collateralToken.increaseAllowance(liquidationContract.address, disputeBond, { from: disputer });
        assert(
          await didContractThrow(liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer }))
        );
        assert.equal((await collateralToken.balanceOf(disputer)).toString(), disputeBond.toString());
      });
      // Weird edge cases, test anyways:
      it("Liquidation already disputed successfully", async () => {
        await liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
        await liquidationContract.settleDispute(
          liquidationParams.uuid,
          sponsor,
          { rawValue: settlementPrice.toString() },
          true
        );
        // Mint enough tokens to disputer for another dispute bond
        await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });
        assert(
          await didContractThrow(liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer }))
        );
        assert.equal((await collateralToken.balanceOf(disputer)).toString(), disputeBond.toString());
      });
      it("Liquidation already disputed unsuccessfully", async () => {
        await liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
        await liquidationContract.settleDispute(
          liquidationParams.uuid,
          sponsor,
          { rawValue: settlementPrice.toString() },
          false
        );
        // Mint enough tokens to disputer for another dispute bond
        await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });
        assert(
          await didContractThrow(liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer }))
        );
        assert.equal((await collateralToken.balanceOf(disputer)).toString(), disputeBond.toString());
      });
    });

    describe("Settle Dispute: there is not pending dispute", () => {
      it("Cannot settle a Liquidation before a dispute request", async () => {
        assert(
          await didContractThrow(
            liquidationContract.settleDispute(
              liquidationParams.uuid,
              sponsor,
              { rawValue: settlementPrice.toString() },
              true
            )
          )
        );
      });
    });

    describe("Settle Dispute: there is a pending dispute", () => {
      beforeEach(async () => {
        // Dispute the created liquidation
        await liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
      });
      it("Settlement price set properly", async () => {
        await liquidationContract.settleDispute(
          liquidationParams.uuid,
          sponsor,
          { rawValue: settlementPrice.toString() },
          false
        );
        const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
        assert.equal(liquidation.settlementPrice.toString(), settlementPrice.toString());
      });
      it("Dispute Succeeded", async () => {
        await liquidationContract.settleDispute(
          liquidationParams.uuid,
          sponsor,
          { rawValue: settlementPrice.toString() },
          true
        );
        const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
        assert.equal(liquidation.state.toString(), STATES.DISPUTE_SUCCEEDED);
      });
      it("Dispute Failed", async () => {
        await liquidationContract.settleDispute(
          liquidationParams.uuid,
          sponsor,
          { rawValue: settlementPrice.toString() },
          false
        );
        const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
        assert.equal(liquidation.state.toString(), STATES.DISPUTE_FAILED);
      });
    });

    describe("Withdraw: Liquidation is pending a dispute", () => {
      beforeEach(async () => {
        // Dispute a liquidation
        await liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
      });
      it("Fails even regardless if liquidation expires", async () => {
        assert(
          await didContractThrow(
            liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator })
          )
        );
        // Expire contract
        await liquidationContract.setCurrentTime(
          BN(startTime)
            .plus(liquidationLiveness)
            .toString()
        );
        assert(
          await didContractThrow(
            liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator })
          )
        );
      });
    });

    describe("Withdraw: Liquidation expires (but synthetic token has not expired)", () => {
      beforeEach(async () => {
        // Expire contract
        await liquidationContract.setCurrentTime(
          BN(startTime)
            .plus(liquidationLiveness)
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
            liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: sponsor })
          )
        );
      });
      it("Liquidator calls", async () => {
        await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator });
        assert.equal((await collateralToken.balanceOf(liquidator)).toString(), amountOfCollateral.toString());
      });
      it("After liquidator calls, liquidation is deleted and last used index remains the same", async () => {
        // Withdraw from disputed liquidation and delete it
        await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator });
        const deletedLiquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
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
        const uuid = await liquidationContract.createLiquidation.call(sponsor, { from: liquidator });
        await liquidationContract.createLiquidation(sponsor, { from: liquidator });
        assert.equal(
          uuid.toString(),
          BN(liquidationParams.uuid)
            .plus(1)
            .toString()
        );
      });
      it("Disputer calls", async () => {
        assert(
          await didContractThrow(
            liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: disputer })
          )
        );
      });
      it("Rando calls", async () => {
        assert(
          await didContractThrow(
            liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: rando })
          )
        );
      });
    });

    describe("Withdraw: Liquidation dispute resolves", () => {
      beforeEach(async () => {
        // Dispute
        await liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
      });
      describe("Dispute succeeded", () => {
        beforeEach(async () => {
          // Settle the dispute as SUCCESSFUL
          await liquidationContract.settleDispute(
            liquidationParams.uuid,
            sponsor,
            { rawValue: settlementPrice.toString() },
            true
          );
        });
        it("Sponsor calls", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: sponsor });
          // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
          const expectedPayment = amountOfCollateral.minus(settlementTRV).plus(sponsorDisputeReward);
          assert.equal((await collateralToken.balanceOf(sponsor)).toString(), expectedPayment.toString());
        });
        it("Liquidator calls", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator });
          // Expected Liquidator payment => TRV - dispute reward - sponsor reward
          const expectedPayment = settlementTRV.minus(disputerDisputeReward).minus(sponsorDisputeReward);
          assert.equal((await collateralToken.balanceOf(liquidator)).toString(), expectedPayment.toString());
        });
        it("Disputer calls", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: disputer });
          // Expected Disputer payment => disputer reward + dispute bond
          const expectedPayment = disputerDisputeReward.plus(disputeBond);
          assert.equal((await collateralToken.balanceOf(disputer)).toString(), expectedPayment.toString());
        });
        it("Rando calls", async () => {
          assert(
            await didContractThrow(
              liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: rando })
            )
          );
        });
        it("Withdraw still succeeds even if Liquidation has expired", async () => {
          // Expire contract
          await liquidationContract.setCurrentTime(
            BN(startTime)
              .plus(liquidationLiveness)
              .toString()
          );
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: sponsor });
        });
        it("Liquidated contact should have no assets remaining after all withdrawals and be deleted", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: sponsor });
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator });
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: disputer });
          assert.equal((await collateralToken.balanceOf(liquidationContract.address)).toString(), "0");
          const deletedLiquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
          assert.equal(deletedLiquidation.liquidator, zeroAddress);
        });
      });
      describe("Dispute failed", () => {
        beforeEach(async () => {
          // Settle the dispute as FAILED
          await liquidationContract.settleDispute(
            liquidationParams.uuid,
            sponsor,
            { rawValue: settlementPrice.toString() },
            false
          );
        });
        it("Sponsor calls", async () => {
          assert(
            await didContractThrow(
              liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: sponsor })
            )
          );
        });
        it("Liquidator calls, liquidation is deleted", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator });
          // Expected Liquidator payment => lockedCollateral + liquidation.disputeBond % of liquidation.lockedCollateral to liquidator
          const expectedPayment = amountOfCollateral.plus(disputeBond);
          assert.equal((await collateralToken.balanceOf(liquidator)).toString(), expectedPayment.toString());
          assert.equal((await collateralToken.balanceOf(liquidationContract.address)).toString(), "0");
          const deletedLiquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
          assert.equal(deletedLiquidation.liquidator, zeroAddress);
        });
        it("Disputer calls", async () => {
          assert(
            await didContractThrow(
              liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: disputer })
            )
          );
        });
        it("Rando calls", async () => {
          assert(
            await didContractThrow(
              liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: rando })
            )
          );
        });
        it("Withdraw still succeeds even if Liquidation has expired", async () => {
          // Expire contract
          await liquidationContract.setCurrentTime(
            BN(startTime)
              .plus(liquidationLiveness)
              .toString()
          );
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator });
        });
      });
    });
  });

  describe("Weird Edge cases", () => {
    it("Dispute rewards should not sum to over 100% of TRV", async () => {
      // Deploy liquidation contract and set global params
      assert(
        await didContractThrow(
          Liquidatable.new(
            true,
            BN(startTime)
              .plus(positionLiveness)
              .toString(),
            withdrawalLiveness.toString(),
            collateralToken.address,
            { rawValue: disputeBondPct.toString() },
            { rawValue: toWei("0.5") },
            { rawValue: toWei("0.5") },
            liquidationLiveness.toString(),
            { from: contractDeployer }
          )
        )
      );
    });
    it("Dispute bond can be over 100%", async () => {
      const edgeDisputeBondPct = BN(toWei("1.0"));
      const edgeDisputeBond = edgeDisputeBondPct.times(amountOfCollateral).dividedBy(toWei("1"));

      // Send away previous balances
      await collateralToken.transfer(contractDeployer, disputeBond, { from: disputer });
      await collateralToken.transfer(contractDeployer, amountOfCollateral, { from: sponsor });

      // Create  Liquidation
      const edgeLiquidationContract = await Liquidatable.new(
        true,
        BN(startTime)
          .plus(positionLiveness)
          .toString(),
        withdrawalLiveness.toString(),
        collateralToken.address,
        { rawValue: edgeDisputeBondPct.toString() },
        { rawValue: sponsorDisputeRewardPct.toString() },
        { rawValue: disputerDisputeRewardPct.toString() },
        liquidationLiveness.toString(),
        { from: contractDeployer }
      );
      // Get newly created synthetic token
      const edgeSyntheticToken = await ERC20Mintable.at(await edgeLiquidationContract.tokenCurrency());
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
      await edgeLiquidationContract.createLiquidation(sponsor, { from: liquidator });
      // Dispute
      await edgeLiquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
      // Settle the dispute as SUCCESSFUL
      await edgeLiquidationContract.settleDispute(
        liquidationParams.uuid,
        sponsor,
        { rawValue: settlementPrice.toString() },
        true
      );
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: disputer });
      // Expected Disputer payment => disputer reward + dispute bond
      const expectedPaymentDisputer = disputerDisputeReward.plus(edgeDisputeBond);
      assert.equal((await collateralToken.balanceOf(disputer)).toString(), expectedPaymentDisputer.toString());
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator });
      // Expected Liquidator payment => TRV - dispute reward - sponsor reward
      const expectedPaymentLiquidator = settlementTRV.minus(disputerDisputeReward).minus(sponsorDisputeReward);
      assert.equal((await collateralToken.balanceOf(liquidator)).toString(), expectedPaymentLiquidator.toString());
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: sponsor });
      // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
      const expectedPaymentSponsor = amountOfCollateral.minus(settlementTRV).plus(sponsorDisputeReward);
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), expectedPaymentSponsor.toString());
    });
    it("Liquidation is disputed successfully but TRV > Collateral, so sponsor has no excess collateral", async () => {
      const edgeAmountOfCollateral = BN(toWei("50"));
      const edgeSponsorReward = sponsorDisputeRewardPct.times(edgeAmountOfCollateral).dividedBy(toWei("1"));

      // Send away previous balances
      await collateralToken.transfer(contractDeployer, disputeBond, { from: disputer });
      await collateralToken.transfer(contractDeployer, amountOfCollateral, { from: sponsor });

      // Create  Liquidation
      const edgeLiquidationContract = await Liquidatable.new(
        true,
        BN(startTime)
          .plus(positionLiveness)
          .toString(),
        withdrawalLiveness.toString(),
        collateralToken.address,
        { rawValue: disputeBondPct.toString() },
        { rawValue: sponsorDisputeRewardPct.toString() },
        { rawValue: disputerDisputeRewardPct.toString() },
        liquidationLiveness.toString(),
        { from: contractDeployer }
      );
      // Get newly created synthetic token
      const edgeSyntheticToken = await ERC20Mintable.at(await edgeLiquidationContract.tokenCurrency());
      // Reset start time signifying the beginning of the first liquidation
      await edgeLiquidationContract.setCurrentTime(startTime);
      // Mint collateral to sponsor
      await collateralToken.mint(sponsor, edgeAmountOfCollateral, { from: contractDeployer });
      // Mint dispute bond to disputer
      await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });
      // Set allowance for contract to pull collateral tokens from sponsor
      await collateralToken.increaseAllowance(edgeLiquidationContract.address, edgeAmountOfCollateral, {
        from: sponsor
      });
      // Set allowance for contract to pull dispute bond from disputer
      await collateralToken.increaseAllowance(edgeLiquidationContract.address, disputeBond, { from: disputer });
      // Set allowance for contract to pull synthetic tokens from liquidator
      await edgeSyntheticToken.increaseAllowance(edgeLiquidationContract.address, amountOfSynthetic, {
        from: liquidator
      });
      // Create position
      await edgeLiquidationContract.create(
        { rawValue: edgeAmountOfCollateral.toString() },
        { rawValue: amountOfSynthetic.toString() },
        { from: sponsor }
      );
      // Transfer synthetic tokens to a liquidator
      await edgeSyntheticToken.transfer(liquidator, amountOfSynthetic, { from: sponsor });
      // Create a Liquidation
      await edgeLiquidationContract.createLiquidation(sponsor, { from: liquidator });
      // Dispute
      await edgeLiquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
      // Settle the dispute as SUCCESSFUL
      await edgeLiquidationContract.settleDispute(
        liquidationParams.uuid,
        sponsor,
        { rawValue: settlementPrice.toString() },
        true
      );
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: sponsor });
      // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
      const expectedPaymentSponsor = edgeSponsorReward;
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), expectedPaymentSponsor.toString());
    });
    it("Liquidation is disputed successfully but TRV > collateral, so disputer rewards are drawn from collateral instead of TRV", async () => {
      const edgeSettlementPrice = BN(toWei("3.0"));
      const edgeSponsorRewardPct = BN(toWei("0.4"));
      const edgeSponsorReward = edgeSponsorRewardPct.times(amountOfCollateral).dividedBy(toWei("1"));
      const edgeDisputerRewardPct = BN(toWei("0.25"));
      const edgeDisputerReward = edgeDisputerRewardPct.times(amountOfCollateral).dividedBy(toWei("1"));

      // Send away previous balances
      await collateralToken.transfer(contractDeployer, disputeBond, { from: disputer });
      await collateralToken.transfer(contractDeployer, amountOfCollateral, { from: sponsor });

      // Create  Liquidation
      const edgeLiquidationContract = await Liquidatable.new(
        true,
        BN(startTime)
          .plus(positionLiveness)
          .toString(),
        withdrawalLiveness.toString(),
        collateralToken.address,
        { rawValue: disputeBondPct.toString() },
        { rawValue: edgeSponsorRewardPct.toString() },
        { rawValue: edgeDisputerRewardPct.toString() },
        liquidationLiveness.toString(),
        { from: contractDeployer }
      );
      // Get newly created synthetic token
      const edgeSyntheticToken = await ERC20Mintable.at(await edgeLiquidationContract.tokenCurrency());
      // Reset start time signifying the beginning of the first liquidation
      await edgeLiquidationContract.setCurrentTime(startTime);
      // Mint collateral to sponsor
      await collateralToken.mint(sponsor, amountOfCollateral, { from: contractDeployer });
      // Mint dispute bond to disputer
      await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });
      // Set allowance for contract to pull collateral tokens from sponsor
      await collateralToken.increaseAllowance(edgeLiquidationContract.address, amountOfCollateral, { from: sponsor });
      // Set allowance for contract to pull dispute bond from disputer
      await collateralToken.increaseAllowance(edgeLiquidationContract.address, disputeBond, { from: disputer });
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
      await edgeLiquidationContract.createLiquidation(sponsor, { from: liquidator });
      // Dispute
      await edgeLiquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
      // Settle the dispute as SUCCESSFUL
      await edgeLiquidationContract.settleDispute(
        liquidationParams.uuid,
        sponsor,
        { rawValue: edgeSettlementPrice.toString() },
        true
      );

      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: sponsor });
      // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
      const expectedPaymentSponsor = edgeSponsorReward;
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), expectedPaymentSponsor.toString());

      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: disputer });
      // Expected Disputer payment => disputer reward + dispute bond
      const expectedPaymentDisputer = edgeDisputerReward.plus(disputeBond);
      assert.equal((await collateralToken.balanceOf(disputer)).toString(), expectedPaymentDisputer.toString());

      // Expected Liquidator payment => *Collateral - dispute reward - sponsor reward
      // *This is Collateral instead of TRV because TRV > Collateral
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator });
      // Expected Disputer payment => disputer reward + dispute bond
      const expectedPaymentLiquidator = amountOfCollateral.minus(edgeDisputerReward).minus(edgeSponsorReward);
      assert.equal((await collateralToken.balanceOf(liquidator)).toString(), expectedPaymentLiquidator.toString());
    });
  });
});
