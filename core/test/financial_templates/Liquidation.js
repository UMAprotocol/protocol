// Helper scripts
const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const BN = require("bignumber.js");
const truffleAssert = require("truffle-assertions");
const { toWei } = web3.utils;

// Helper Contracts
const ERC20MintableData = require("@openzeppelin/contracts/build/contracts/ERC20Mintable.json");
const truffleContract = require("@truffle/contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

// Contracts to unit test:
const Liquidation = artifacts.require("Liquidation");

contract("Liquidation", function(accounts) {
  // Roles
  const contractDeployer = accounts[0];
  const sponsor = accounts[1];
  const liquidator = accounts[2];
  const disputer = accounts[3];
  const rando = accounts[4];
  const zeroAddress = "0x0000000000000000000000000000000000000000";

  // Amount of tokens to mint for test
  const amountOfCollateral = BN(toWei("150"));
  const amountOfCollateralToLiquidate = BN(toWei("150"));
  // @dev: Amount to liquidate can be less than amount of collateral iff there is a pending withdrawal
  const amountOfSynthetic = BN(toWei("100"));

  // Settlement price
  const settlementPrice = BN(toWei("1"));

  // Settlement TRV
  const settlementTRV = amountOfSynthetic.times(settlementPrice);

  // Liquidation contract params
  const disputeBondPct = BN(toWei("0.1"));
  const disputeBond = disputeBondPct.dividedBy(toWei("1")).times(amountOfCollateral);
  const sponsorDisputeRewardPct = BN(toWei("0.05"));
  const sponsorDisputeReward = sponsorDisputeRewardPct
    .div(toWei("1"))
    .times(settlementTRV)
    .dividedBy(toWei("1"));
  const disputerDisputeRewardPct = BN(toWei("0.05"));
  const disputerDisputeReward = disputerDisputeRewardPct
    .div(toWei("1"))
    .times(settlementTRV)
    .dividedBy(toWei("1"));
  const liquidationLiveness = BN(60)
    .times(60)
    .times(1); // In seconds
  const startTime = "15798990420";

  // Contracts
  let liquidationContract;
  let collateralToken;
  let syntheticToken;

  // Basic liquidation params
  const liquidationParams = {
    uuid: 1,
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
    syntheticToken = await ERC20Mintable.new({ from: contractDeployer });

    // Deploy liquidation contract and set global params
    liquidationContract = await Liquidation.new(
      true,
      collateralToken.address,
      syntheticToken.address,
      { rawValue: disputeBondPct.toString() },
      { rawValue: sponsorDisputeRewardPct.toString() },
      { rawValue: disputerDisputeRewardPct.toString() },
      liquidationLiveness.toString(),
      { from: contractDeployer }
    );

    // Hardcode start time
    await liquidationContract.setCurrentTime(startTime);

    // Mint collateral to Liquidation contract
    await collateralToken.mint(liquidationContract.address, amountOfCollateral, { from: contractDeployer });

    // Mint dispute bond amount of collateral to disputer
    await collateralToken.mint(disputer, disputeBond, { from: contractDeployer });

    // Mint synthetic tokens to a liquidator
    await syntheticToken.mint(liquidator, amountOfSynthetic, { from: contractDeployer });

    // Set allowance for contract to pull dispute bond from disputer
    await collateralToken.increaseAllowance(liquidationContract.address, disputeBond, { from: disputer });

    // Set allowance for contract to pull synthetic tokens from liquidator
    await syntheticToken.increaseAllowance(liquidationContract.address, amountOfSynthetic, { from: liquidator });
  });

  describe("Creating a liquidation", () => {
    it("Liquidator does not have enough tokens to retire position", async () => {
      await syntheticToken.transfer(contractDeployer, toWei("1"), { from: liquidator });
      assert(
        await didContractThrow(
          liquidationContract.createLiquidation(
            sponsor,
            liquidationParams.uuid,
            { rawValue: liquidationParams.tokensOutstanding.toString() },
            { rawValue: liquidationParams.lockedCollateral.toString() },
            { rawValue: liquidationParams.liquidatedCollateral.toString() },
            { from: liquidator }
          )
        )
      );
    });
  });

  describe("Liquidation has been created", () => {
    beforeEach(async () => {
      // Create a Liquidation
      await liquidationContract.createLiquidation(
        sponsor,
        liquidationParams.uuid,
        { rawValue: liquidationParams.tokensOutstanding.toString() },
        { rawValue: liquidationParams.lockedCollateral.toString() },
        { rawValue: liquidationParams.liquidatedCollateral.toString() },
        { from: liquidator }
      );
    });

    describe("Get a Liquidation", () => {
      it("Liquidator redeemed synthetic tokens", async () => {
        assert.equal((await syntheticToken.balanceOf(liquidator)).toString(), "0");
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

    describe("Withdraw: Liquidation expires", () => {
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

    describe("Withdraw: Liquidation is disputed", () => {
      beforeEach(async () => {
        // Dispute
        // Settle the dispute
      });
      it("Liquidation does not exist", async () => {});
      it("Dispute succeeded", async () => {
        it("Sponsor calls", async () => {});
        it("Liquidator calls", async () => {});
        it("Disputer calls", async () => {});
        it("Rando calls", async () => {});
        it("Withdraw still succeeds even if Liquidation has expired", async () => {});
      });
      it("Dispute failed", async () => {
        it("Sponsor calls", async () => {});
        it("Liquidator calls", async () => {});
        it("Disputer calls", async () => {});
        it("Rando calls", async () => {});
        it("Withdraw still succeeds even if Liquidation has expired", async () => {});
      });
    });
  });
});
