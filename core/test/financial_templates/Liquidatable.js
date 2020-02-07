// Helper scripts
const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const truffleAssert = require("truffle-assertions");
const { toWei, hexToUtf8, toBN } = web3.utils;

// Helper Contracts
const ERC20MintableData = require("@openzeppelin/contracts/build/contracts/ERC20Mintable.json");
const truffleContract = require("@truffle/contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

// Contracts to unit test
const Liquidatable = artifacts.require("Liquidatable");

// Other UMA related contracts and mocks
const Finder = artifacts.require("Finder");
const MockOracle = artifacts.require("MockOracle");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");

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
  let priceTrackingIdentifier;
  let mockOracle;
  let finder;
  let liquidatableParameters;

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

    // Create identifier whitelist and register the price tracking ticker with it.
    identifierWhitelist = await IdentifierWhitelist.new({ from: contractDeployer });
    priceTrackingIdentifier = web3.utils.utf8ToHex("ETHUSD");
    await identifierWhitelist.addSupportedIdentifier(priceTrackingIdentifier, {
      from: contractDeployer
    });

    // Create a mockOracle and finder. Register the mockMoracle with the finder.
    mockOracle = await MockOracle.new(identifierWhitelist.address, {
      from: contractDeployer
    });
    finder = await Finder.new({ from: contractDeployer });
    const mockOracleInterfaceName = web3.utils.utf8ToHex("Oracle");
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address, {
      from: contractDeployer
    });

    liquidatableParameters = {
      isTest: true,
      expirationTimestamp: expirationTimestamp,
      withdrawalLiveness: withdrawalLiveness.toString(),
      collateralAddress: collateralToken.address,
      finderAddress: finder.address,
      priceFeedIdentifier: priceTrackingIdentifier,
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
    it("Emits an event", async () => {
      const createLiquidationResult = await liquidationContract.createLiquidation(sponsor, { from: liquidator });
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
        toBN(liquidationParams.uuid)
          .addn(1)
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
      it("Liquidation decrease underlying token debt and collateral", async () => {
        const totalPositionCollateralAfter = await liquidationContract.totalPositionCollateral();
        assert.equal(totalPositionCollateralAfter.toNumber(), 0);
        const totalTokensOutstandingAfter = await liquidationContract.totalTokensOutstanding();
        assert.equal(totalTokensOutstandingAfter.toNumber(), 0);
      });
      it("Liquidation exists and params are set properly", async () => {
        const newLiquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
        assert.equal(newLiquidation.state.toString(), STATES.PRE_DISPUTE);
        assert.equal(newLiquidation.tokensOutstanding.toString(), liquidationParams.tokensOutstanding.toString());
        assert.equal(newLiquidation.lockedCollateral.toString(), liquidationParams.lockedCollateral.toString());
        assert.equal(newLiquidation.liquidatedCollateral.toString(), liquidationParams.liquidatedCollateral.toString());
        assert.equal(
          newLiquidation.expiry.toString(),
          toBN(startTime)
            .add(liquidationLiveness)
            .toString()
        );
        assert.equal(newLiquidation.liquidator, liquidator);
        assert.equal(newLiquidation.disputer, zeroAddress);
        assert.equal(newLiquidation.disputeTime.toString(), "0");
        assert.equal(newLiquidation.settlementPrice.toString(), "0");
      });
      it("Liquidation does not exist", async () => {
        const uncreatedLiquidation = assert(
          await didContractThrow(liquidationContract.liquidations(sponsor, liquidationParams.falseUuid))
        );
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
          toBN(startTime)
            .add(liquidationLiveness)
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
      it("Dispute emits and event", async () => {
        const disputeResult = await liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
        truffleAssert.eventEmitted(disputeResult, "LiquidationDisputed", ev => {
          return (
            ev.sponsor == sponsor &&
            ev.liquidator == liquidator &&
            ev.disputer == disputer &&
            ev.disputeId == 0 &&
            ev.disputeBondAmount == toWei("15").toString() //10% of the collateral as disputeBondPct * amountOfCollateral
          );
        });
      });
      it("Dispute initiates an oracle call", async () => {
        const disputeTime = await liquidationContract.getCurrentTime();
        await liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
        // Oracle should have an enqueued price after calling dispute
        const pendingRequests = await mockOracle.getPendingQueries();
        assert.equal(hexToUtf8(pendingRequests[0]["identifier"]), hexToUtf8(priceTrackingIdentifier));
        assert.equal(pendingRequests[0].time, disputeTime);
      });
      it("Throw if liquidation has already been disputed", async () => {
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

        // Push to oracle.
        const disputeTime = await liquidationContract.getCurrentTime();
        await mockOracle.pushPrice(priceTrackingIdentifier, disputeTime, settlementPrice.toString());

        await liquidationContract.settleDispute(liquidationParams.uuid, sponsor);
        // Mint enough tokens to disputer for another dispute bond
        await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });
        assert(
          await didContractThrow(liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer }))
        );
        assert.equal((await collateralToken.balanceOf(disputer)).toString(), disputeBond.toString());
      });
      it("Liquidation already disputed unsuccessfully", async () => {
        await liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });

        // Push to oracle.
        const disputeTime = await liquidationContract.getCurrentTime();
        await mockOracle.pushPrice(priceTrackingIdentifier, disputeTime, settlementPrice.toString());

        await liquidationContract.settleDispute(liquidationParams.uuid, sponsor);
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
        assert(await didContractThrow(liquidationContract.settleDispute(liquidationParams.uuid, sponsor)));
      });
    });

    describe("Settle Dispute: there is a pending dispute", () => {
      beforeEach(async () => {
        // Dispute the created liquidation
        await liquidationContract.dispute(liquidationParams.uuid, sponsor, { from: disputer });
      });
      it("Settlement price set properly", async () => {
        // After the dispute call the oracle is requested a price. As such, push a price into the oracle at that
        // timestamp for the contract price identifer. Check that the value is set correctly for the dispute object.
        const disputeTime = await liquidationContract.getCurrentTime();
        const disputePrice = toWei("1");
        await mockOracle.pushPrice(priceTrackingIdentifier, disputeTime, disputePrice);

        await liquidationContract.settleDispute(liquidationParams.uuid, sponsor);
        const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
        assert.equal(liquidation.settlementPrice.toString(), disputePrice);
      });
      it("Dispute Succeeded", async () => {
        // For a successful dispute the price needs to result in the position being correctly collateralized (to invalidate the
        // liquidation). Any price below 1.25 for a debt of 100 with 150 units of underlying should result in successful dispute.

        const disputeTime = await liquidationContract.getCurrentTime();
        const disputePrice = toWei("1");
        await mockOracle.pushPrice(priceTrackingIdentifier, disputeTime, disputePrice);

        await liquidationContract.settleDispute(liquidationParams.uuid, sponsor);
        const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
        assert.equal(liquidation.state.toString(), STATES.DISPUTE_SUCCEEDED);
      });
      it("Dispute Failed", async () => {
        // For a failed dispute the price needs to result in the position being incorrectly collateralized (the liquidation is valid).
        //Any price above 1.25 for a debt of 100 with 150 units of underlying should result in failed dispute and a successful liquidation.

        const disputeTime = await liquidationContract.getCurrentTime();
        const disputePrice = toWei("1.3");
        await mockOracle.pushPrice(priceTrackingIdentifier, disputeTime, disputePrice);

        await liquidationContract.settleDispute(liquidationParams.uuid, sponsor);
        const liquidation = await liquidationContract.liquidations(sponsor, liquidationParams.uuid);
        assert.equal(liquidation.state.toString(), STATES.DISPUTE_FAILED);
      });
      it("Event correctly emitted", async () => {
        // Create a successful dispute and check the event is correct.

        const disputeTime = await liquidationContract.getCurrentTime();
        const disputePrice = toWei("1");
        await mockOracle.pushPrice(priceTrackingIdentifier, disputeTime, disputePrice);

        const settleDisputeResult = await liquidationContract.settleDispute(liquidationParams.uuid, sponsor, {
          from: rando
        });

        truffleAssert.eventEmitted(settleDisputeResult, "DisputeSettled", ev => {
          return (
            ev.caller == rando &&
            ev.sponsor == sponsor &&
            ev.liquidator == liquidator &&
            ev.disputer == disputer &&
            ev.disputeId == 0 &&
            ev.DisputeSucceeded
          );
        });
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
          toBN(startTime)
            .add(liquidationLiveness)
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
          toBN(liquidationParams.uuid)
            .addn(1)
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
          // Settle the dispute as SUCCESSFUL. for this the liquidation needs to be unsuccessful.
          const disputeTime = await liquidationContract.getCurrentTime();
          const disputePrice = toWei("1");
          await mockOracle.pushPrice(priceTrackingIdentifier, disputeTime, disputePrice);
          await liquidationContract.settleDispute(liquidationParams.uuid, sponsor);
        });
        it("Sponsor calls", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: sponsor });
          // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
          const expectedPayment = amountOfCollateral.sub(settlementTRV).add(sponsorDisputeReward);
          assert.equal((await collateralToken.balanceOf(sponsor)).toString(), expectedPayment.toString());
        });
        it("Liquidator calls", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator });
          // Expected Liquidator payment => TRV - dispute reward - sponsor reward
          const expectedPayment = settlementTRV.sub(disputerDisputeReward).sub(sponsorDisputeReward);
          assert.equal((await collateralToken.balanceOf(liquidator)).toString(), expectedPayment.toString());
        });
        it("Disputer calls", async () => {
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: disputer });
          // Expected Disputer payment => disputer reward + dispute bond
          const expectedPayment = disputerDisputeReward.add(disputeBond);
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
            toBN(startTime)
              .add(liquidationLiveness)
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
        it("Event emmited", async () => {
          const withdrawalResult = await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, {
            from: sponsor
          });

          // TODO: flesh out this test with other params when they are added to the event in `Liquidatable.sol`
          truffleAssert.eventEmitted(withdrawalResult, "LiquidationWithdrawn", ev => {
            return ev.caller == sponsor;
          });
        });
      });
      describe("Dispute failed", () => {
        beforeEach(async () => {
          // Settle the dispute as FAILED. To achieve this the liquidation must be correct.
          const disputeTime = await liquidationContract.getCurrentTime();
          const disputePrice = toWei("1.3");
          await mockOracle.pushPrice(priceTrackingIdentifier, disputeTime, disputePrice);
          await liquidationContract.settleDispute(liquidationParams.uuid, sponsor);
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
          const expectedPayment = amountOfCollateral.add(disputeBond);
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
            toBN(startTime)
              .add(liquidationLiveness)
              .toString()
          );
          await liquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator });
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
      const disputeTime = await liquidationContract.getCurrentTime();
      await mockOracle.pushPrice(priceTrackingIdentifier, disputeTime, settlementPrice.toString());
      await edgeLiquidationContract.settleDispute(liquidationParams.uuid, sponsor);
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: disputer });
      // Expected Disputer payment => disputer reward + dispute bond
      const expectedPaymentDisputer = disputerDisputeReward.add(edgeDisputeBond);
      assert.equal((await collateralToken.balanceOf(disputer)).toString(), expectedPaymentDisputer.toString());
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: liquidator });
      // Expected Liquidator payment => TRV - dispute reward - sponsor reward
      const expectedPaymentLiquidator = settlementTRV.sub(disputerDisputeReward).sub(sponsorDisputeReward);
      assert.equal((await collateralToken.balanceOf(liquidator)).toString(), expectedPaymentLiquidator.toString());
      await edgeLiquidationContract.withdrawLiquidation(liquidationParams.uuid, sponsor, { from: sponsor });
      // Expected Sponsor payment => remaining collateral (locked collateral - TRV) + sponsor reward
      const expectedPaymentSponsor = amountOfCollateral.sub(settlementTRV).add(sponsorDisputeReward);
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), expectedPaymentSponsor.toString());
    });
  });
});
