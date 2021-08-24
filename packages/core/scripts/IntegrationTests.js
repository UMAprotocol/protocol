/**
 * @notice This test script runs a number of integration tests between all layers of the
 * smart contracts to stress test logic to ensure contract state never locks.
 * For example all branches where fees get taken out (positions, liquidations, partial liquidations)
 * are tested to see if there is any leftover wei or whether contracts get locked. These tests do not
 * aim to quantify the rounding error (for this see PrecisionErrors.js) but rather aim test the holistic
 * impact of rounding on contract operation.
 * @dev this script uses all 10 default ganache accounts in testing to mock a number of liquidators,
 * disputers, sponsors and token holders.
 *
 * Assumptions: You are currently in the `/core` directory.
 * Run: $(npm bin)/truffle test ./scripts/IntegrationTests.js --network test
 *
 */

// Helpers
const { toWei, toBN } = web3.utils;
const { RegistryRolesEnum, MAX_UINT_VAL } = require("@uma/common");
const { interfaceName } = require("@uma/common");

// Contract to test
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");

// Other UMA related contracts and mocks
const Token = artifacts.require("ExpandedERC20");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const TokenFactory = artifacts.require("TokenFactory");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const MockOracle = artifacts.require("MockOracle");
const Store = artifacts.require("Store");
const Timer = artifacts.require("Timer");

contract("IntegrationTest", function (accounts) {
  let contractCreator = accounts[0];
  let liquidator = accounts[1];
  let disputer = accounts[2];
  let sponsors = accounts.slice(3, 6); // accounts 3 -> 5
  let tokenHolders = accounts.slice(7, 10); // accounts 6 -> 9

  // Contract variables
  let collateralToken;
  let syntheticToken;
  let expiringMultiPartyCreator;
  let registry;
  let mockOracle;
  let collateralTokenWhitelist;
  let expiringMultiParty;
  let store;

  // Re-used variables
  let constructorParams;
  let startingTime;
  let expirationTime;

  const mintAndApprove = toBN(toWei("100000000000000")); // number of tokens minted and approved by each account
  const timeOffsetBetweenTests = toBN(60 * 60); // timestep advance between loop iterations (1 hour)
  const unreachableDeadline = MAX_UINT_VAL;

  beforeEach(async () => {
    collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractCreator });
    await collateralToken.addMember(1, contractCreator, { from: contractCreator });
    registry = await Registry.deployed();
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address, {
      from: contractCreator,
    });

    collateralTokenWhitelist = await AddressWhitelist.at(await expiringMultiPartyCreator.collateralTokenWhitelist());
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, { from: contractCreator });

    startingTime = await expiringMultiPartyCreator.getCurrentTime();
    expirationTime = startingTime.add(toBN(60 * 60 * 24 * 30 * 3)); // Three month in the future
    constructorParams = {
      expirationTimestamp: expirationTime.toString(),
      withdrawalLiveness: "3600",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      timerAddress: Timer.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("TEST_IDENTIFIER"),
      syntheticName: "Test Synthetic Token",
      syntheticSymbol: "SYNTH",
      liquidationLiveness: "3600",
      collateralRequirement: { rawValue: toWei("1.2") },
      disputeBondPercentage: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
      disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
      minSponsorTokens: { rawValue: toWei("0") },
    };

    // register the price identifer within the identifer whitelist
    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, { from: contractCreator });

    const finder = await Finder.deployed();

    // Create a mockOracle and get the deployed finder. Register the mockMoracle with the finder.
    mockOracle = await MockOracle.new(finder.address, Timer.address, { from: contractCreator });

    store = await Store.deployed();

    await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle), mockOracle.address, {
      from: contractCreator,
    });

    expiringMultiParty = await ExpiringMultiParty.new(constructorParams);

    syntheticToken = await Token.at(await expiringMultiParty.tokenCurrency());

    for (const account of accounts) {
      // approve the tokens
      await collateralToken.approve(expiringMultiParty.address, mintAndApprove, { from: account });
      await syntheticToken.approve(expiringMultiParty.address, mintAndApprove, { from: account });

      // mint collateral for all accounts
      await collateralToken.mint(account, mintAndApprove, { from: contractCreator });
    }
  });
  it("Iterative full life cycle test with friendly numbers", async function () {
    /**
     * @notice Iterative test with sponsors, liquidations and disputes.
     * Number of positions to create and liquidate. The following process is followed to
     * initiate maximum interaction with the emp & fee paying function to try and compound
     *  floating errors to see if positions are locked at settlement:
     * 0.a) set the oracle fee
     * 0.b) create a large position by the liquidator to enable them to perform liquidations
     * 1) position created by selected sponsor
     * 2) random amount of tokens sent to a selected tokenholder
     * 3) time advanced by 1000 seconds
     * 4) 1/3 chance to initiate liquidation
     * 4.a) if liquidation initiated then time advanced
     * 4.b) 1/2chance to dispute
     * 4.b.i) if disputed then resolve oracle price
     * 5) chance for token sponsor to deposit more collateral
     * 6) chance for the sponsor to redeem collateral
     * 7) repeat 1 to 6 `numIterations` times
     * 8) withdraw successful (or failed) liquidation returns from sponsors, liquidators and disputers
     * 9) settle contract
     * 10) ensure that all users can withdraw their funds
     * 11) check the contract has no funds left in it
     */

    // Test settings
    const numIterations = 20; // number of times the simulation loop is run
    const runLiquidations = true; // if liquidations should occur in the loop
    const runDisputes = true; // if disputes should occur in the loop
    const runExtraDeposits = true; // if the sponsor should have a chance to add more
    const runRedeemTokens = true; // if the sponsor should have a chance to redeem some of their tokens

    // Tunable parameters
    const baseCollateralAmount = toBN(toWei("150")); // starting amount of collateral deposited by sponsor
    const baseNumTokens = toBN(toWei("100")); // starting number of tokens created by sponsor
    const settlementPrice = toBN(toWei("1")); // Price the contract resolves to
    const disputePrice = toBN(toWei("1")); // Price a dispute will resolve to
    const depositAmount = toBN(toWei("10")); // Amount of additional collateral to add to a position
    const redeemAmount = toBN(toWei("1")); // The number of synthetic tokens to redeem for collateral
    const dvmRegularFee = toBN("0"); // DVM fee

    // Counter variables
    let positionsCreated = 0;
    let tokenTransfers = 0;
    let depositsMade = 0;
    let redemptionsMade = 0;
    let liquidationsObject = [];

    // STEP: 0.a) set the oracle fee
    await store.setFixedOracleFeePerSecondPerPfc({ rawValue: dvmRegularFee.toString() }, { from: contractCreator });

    // STEP: 0.b: seed liquidator
    console.log("Seeding liquidator");
    await expiringMultiParty.create(
      { rawValue: baseCollateralAmount.mul(toBN("100")).toString() },
      { rawValue: baseNumTokens.mul(toBN("100")).toString() },
      { from: liquidator }
    );

    let sponsor;
    let tokenHolder;
    console.log("Creating positions, liquidations and disputes iteratively\nIteration counter:");
    for (let i = 0; i < numIterations; i++) {
      process.stdout.write(i.toString() + ", ");
      // pick the sponsor and token holder from their arrays
      sponsor = sponsors[i % sponsors.length];
      tokenHolder = tokenHolders[i % tokenHolders.length];

      // STEP 1: creating position
      const tokensOutstanding = await expiringMultiParty.totalTokensOutstanding();
      const rawCollateral = await expiringMultiParty.rawTotalPositionCollateral();
      const GCR = rawCollateral.mul(toBN(toWei("1"))).div(tokensOutstanding);
      const collateralNeeded = baseNumTokens.mul(GCR).div(toBN(toWei("1")));

      await expiringMultiParty.create(
        { rawValue: collateralNeeded.toString() },
        { rawValue: baseNumTokens.toString() },
        { from: sponsor }
      );
      positionsCreated++;

      // STEP 2: transferring tokens to the token holder
      if (i % 2 == 1) {
        await syntheticToken.transfer(tokenHolder, baseNumTokens.toString(), { from: sponsor });
        tokenTransfers++;
      }

      // STEP 3: advancing time
      const currentTime = await expiringMultiParty.getCurrentTime();
      await expiringMultiParty.setCurrentTime(currentTime.add(timeOffsetBetweenTests));
      await mockOracle.setCurrentTime(currentTime.add(timeOffsetBetweenTests));

      // STEP 4.a: chance to liquidate position. 1 in 3 will get liquidated
      if (i % 3 == 1 && runLiquidations) {
        const positionTokensOutstanding = (await expiringMultiParty.positions(sponsor)).tokensOutstanding;
        await expiringMultiParty.createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: GCR.toString() }, // the liquidation is submitted at the GCR price
          { rawValue: positionTokensOutstanding.toString() }, // all tokens in the position are liquidated
          unreachableDeadline,
          { from: liquidator }
        );

        // get the liquidation info from the event. Used later on to withdraw by accounts.
        const liquidationEvents = await expiringMultiParty.getPastEvents("LiquidationCreated");
        const liquidationEvent = liquidationEvents[liquidationEvents.length - 1].args;

        liquidationsObject.push({
          sponsor: liquidationEvent.sponsor,
          id: liquidationEvent.liquidationId.toString(),
          disputed: false,
        });

        // STEP 4.b) Chance to dispute the liquidation. 1 in 2 liquidations will get disputed
        if (i % 2 == 1 && runDisputes) {
          // Create the dispute request for the liquidation
          await expiringMultiParty.dispute(liquidationEvent.liquidationId.toString(), liquidationEvent.sponsor, {
            from: disputer,
          });

          // Push a price into the oracle. This will enable resolution later on when the disputer
          // calls `withdrawLiquidation` to extract their winnings.
          const liquidationTime = await expiringMultiParty.getCurrentTime();
          await mockOracle.pushPrice(constructorParams.priceFeedIdentifier, liquidationTime, disputePrice);

          liquidationsObject[liquidationsObject.length - 1].disputed = true;
        }
        // only if a liquidation did not occur do we consider running a deposit or redeem.
      } else {
        // STEP 5): chance for the token sponsor to deposit more collateral
        if (i % 2 == 0 && runExtraDeposits) {
          // Wrap the deposit attempt in a try/catch to deal with a liquidated position reverting deposit
          await expiringMultiParty.deposit({ rawValue: depositAmount.toString() }, { from: sponsor });
          depositsMade++;
        }
        // STEP 6): chance for the token sponsor to redeem some collateral
        if (i % 2 == 1 && runRedeemTokens) {
          // Wrap the deposit attempt in a try/catch to deal with a liquidated position reverting redeem
          await expiringMultiParty.redeem({ rawValue: redeemAmount.toString() }, { from: sponsor });
          redemptionsMade++;
        }
      }
    } // exit iteration loop

    console.log(
      "\nPosition creation done!\nAdvancing time and withdrawing winnings/losses for sponsor, disputer and liquidator from liquidations and disputes"
    );
    // STEP 8): Before settling the contract the liquidator, disruptor and token sponsors need to withdraw from all
    // liquidation events that occurred. To do this we iterate over all liquidations that happened and attempt to withdraw
    // from the liquidation from all three users(sponsor, disputer and liquidator).
    if (runLiquidations) {
      for (const liquidation of liquidationsObject) {
        if (liquidation.disputed) {
          // sponsor and disputer should only withdraw if the liquidation was disputed
          await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, {
            from: liquidation.sponsor,
          });

          await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, { from: disputer });
        }
        // the liquidator should always try withdraw, even if disputed
        await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, { from: liquidator });
      }
    }
    // STEP 9): expire the contract and settle positions
    console.log("Advancing time and settling contract");
    await expiringMultiParty.setCurrentTime(expirationTime.toNumber() + 1);
    await mockOracle.setCurrentTime(expirationTime.toNumber() + 1);

    await expiringMultiParty.expire();

    // After expiration the oracle needs to settle the price. Push a price of 1 usd per collateral means that each
    // token is redeemable for 1 unit of underlying.
    const oracleTime = await expiringMultiParty.getCurrentTime();
    await mockOracle.pushPrice(constructorParams.priceFeedIdentifier, oracleTime.subn(1).toString(), settlementPrice);

    // STEP 10): all users withdraw their funds
    // Settle the liquidator
    await expiringMultiParty.settleExpired({ from: liquidator });
    assert.equal(await syntheticToken.balanceOf(liquidator), "0");

    // Settle the disputer
    await expiringMultiParty.settleExpired({ from: disputer });
    assert.equal(await syntheticToken.balanceOf(disputer), "0");

    // Settle token holders
    for (const tokenHolder of tokenHolders) {
      await expiringMultiParty.settleExpired({ from: tokenHolder });
      assert.equal(await syntheticToken.balanceOf(tokenHolder), "0");
    }

    // Settle token sponsors
    for (const sponsor of sponsors) {
      await expiringMultiParty.settleExpired({ from: sponsor });
      assert.equal(await syntheticToken.balanceOf(sponsor), "0");
    }

    console.log("All accounts have been able to withdraw without revert!");
    console.table({
      iterations: numIterations,
      positionsCreated: positionsCreated,
      tokensTransferred: tokenTransfers,
      additionalDepositsMade: depositsMade,
      redemptionsMade: redemptionsMade,
      liquidations: liquidationsObject.length,
      disputedLiquidations: liquidationsObject.filter((liquidation) => liquidation.disputed).length,
      finalBalanceDrift: (await collateralToken.balanceOf(expiringMultiParty.address)).toString(),
    });

    // STEP 11): ensure all funds were taken from the contract.
    // The main assertion we can check is that all users were able to call `settleExpired` without the contract
    // locking up. Additionally, if all book keeping has gone correctly, there should be no collateral left in
    // the expiring multi party as this has all be withdrawn by token holders.
    assert.equal((await collateralToken.balanceOf(expiringMultiParty.address)).toString(), "0");
  });

  it("Iterative full life cycle test with unfriendly numbers and seeded liquidator", async function () {
    // This test follows the exact same pattern as before except the input params are less friendly.
    // As before the liquidator is seeded with one large oversize position which is used to execute
    // liquidations.

    // Test settings
    const numIterations = 10; // number of times the simulation loop is run
    const runLiquidations = true; // if liquidations should occur in the loop
    const runDisputes = true; // if disputes should occur in the loop
    const runExtraDeposits = true; // if the sponsor should have a chance to add more
    const runRedeemTokens = true; // if the sponsor should have a chance to redeem some of their tokens

    // Tunable parameters
    const baseCollateralAmount = toBN(toWei("150.333333333333333333")); // starting amount of collateral deposited by sponsor
    const baseNumTokens = toBN(toWei("99.333333333333333333")); // starting number of tokens created by sponsor
    const settlementPrice = toBN(toWei("1.000000000000000001")); // Price the contract resolves to
    const disputePrice = toBN(toWei("0.999999999999999999")); // Price a dispute will resolve to
    const depositAmount = toBN(toWei("9.999999999999999999")); // Amount of additional collateral to add to a position
    const redeemAmount = toBN(toWei("0.999999999999999999")); // The number of synthetic tokens to redeem for collateral
    const dvmRegularFee = toBN(toWei("0.05")).divn(60 * 60 * 24 * 365); // DVM fee charged per second

    // Counter variables
    let positionsCreated = 0;
    let tokenTransfers = 0;
    let depositsMade = 0;
    let redemptionsMade = 0;
    let liquidationsObject = [];
    let maxCollateralLocked = 0;

    // STEP: 0.a) set the oracle fee
    await store.setFixedOracleFeePerSecondPerPfc({ rawValue: dvmRegularFee.toString() }, { from: contractCreator });

    // STEP: 0.b): seed one over sized position
    console.log("Seeding liquidator");
    await expiringMultiParty.create(
      { rawValue: baseCollateralAmount.mul(toBN("1000000")).toString() },
      { rawValue: baseNumTokens.mul(toBN("1000000")).toString() },
      { from: liquidator }
    );

    let sponsor;
    let tokenHolder;
    console.log("Creating positions, liquidations and disputes iteratively\nIteration counter:");
    for (let i = 0; i < numIterations; i++) {
      process.stdout.write(i.toString() + ", ");
      // pick the sponsor and token holder from their arrays
      sponsor = sponsors[i % sponsors.length];
      tokenHolder = tokenHolders[i % tokenHolders.length];

      // STEP 1: creating position
      const tokensOutstanding = await expiringMultiParty.totalTokensOutstanding();
      const rawCollateral = await expiringMultiParty.rawTotalPositionCollateral();

      const GCR = rawCollateral.mul(toBN(toWei("1"))).div(tokensOutstanding);

      const collateralNeeded = baseNumTokens
        .mul(GCR)
        .div(toBN(toWei("1")))
        .add(toBN("100000"));

      await expiringMultiParty.create(
        { rawValue: collateralNeeded.toString() },
        { rawValue: baseNumTokens.toString() },
        { from: sponsor }
      );
      positionsCreated++;

      // STEP 2: transferring tokens to the token holder
      if (i % 2 == 1) {
        await syntheticToken.transfer(tokenHolder, baseNumTokens.toString(), { from: sponsor });
        tokenTransfers++;
      }

      // STEP 3: advancing time
      const currentTime = await expiringMultiParty.getCurrentTime();
      await expiringMultiParty.setCurrentTime(currentTime.add(timeOffsetBetweenTests));
      await mockOracle.setCurrentTime(currentTime.add(timeOffsetBetweenTests));

      // STEP 4.a: chance to liquidate position. 1 in 3 will get liquidated
      if (i % 3 == 1 && runLiquidations) {
        const positionTokensOutstanding = (await expiringMultiParty.positions(sponsor)).tokensOutstanding;
        await expiringMultiParty.createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: GCR.toString() },
          { rawValue: positionTokensOutstanding.toString() },
          unreachableDeadline,
          { from: liquidator }
        );

        // get the liquidation info from the event. Used later on to withdraw by accounts.
        const liquidationEvents = await expiringMultiParty.getPastEvents("LiquidationCreated");
        const liquidationEvent = liquidationEvents[liquidationEvents.length - 1].args;

        liquidationsObject.push({
          sponsor: liquidationEvent.sponsor,
          id: liquidationEvent.liquidationId.toString(),
          disputed: false,
        });

        // STEP 4.b) Chance to dispute the liquidation. 1 in 2 liquidations will get disputed
        if (i % 2 == 1 && runDisputes) {
          // Create the dispute request for the liquidation
          await expiringMultiParty.dispute(liquidationEvent.liquidationId.toString(), liquidationEvent.sponsor, {
            from: disputer,
          });

          // Push a price into the oracle. This will enable resolution later on when the disputer
          // calls `withdrawLiquidation` to extract their winnings.
          const liquidationTime = await expiringMultiParty.getCurrentTime();
          await mockOracle.pushPrice(constructorParams.priceFeedIdentifier, liquidationTime, disputePrice);

          liquidationsObject[liquidationsObject.length - 1].disputed = true;
        }
      } else {
        // STEP 5): chance for the token sponsor to deposit more collateral
        if (i % 2 == 0 && runExtraDeposits) {
          // Wrap the deposit attempt in a try/catch to deal with a liquidated position reverting deposit

          await expiringMultiParty.deposit({ rawValue: depositAmount.toString() }, { from: sponsor });
          depositsMade++;
        }
        // STEP 6): chance for the token sponsor to redeem some collateral
        if (i % 2 == 1 && runRedeemTokens) {
          // Wrap the deposit attempt in a try/catch to deal with a liquidated position reverting deposit

          await expiringMultiParty.redeem({ rawValue: redeemAmount.toString() }, { from: sponsor });
          redemptionsMade++;
        }
      }
    } // exit iteration loop

    maxCollateralLocked = await expiringMultiParty.rawTotalPositionCollateral();
    console.log("max", maxCollateralLocked.toString());

    console.log(
      "\nPosition creation done!\nAdvancing time and withdrawing winnings/losses for sponsor, disputer and liquidator from liquidations and disputes"
    );
    // STEP 8): Before settling the contract the liquidator, disruptor and token sponsors need to withdraw from all
    // liquidation events that occurred. To do this we iterate over all liquidations that happened and attempt to withdraw
    // from the liquidation from all three users(sponsor, disputer and liquidator).
    if (runLiquidations) {
      for (const liquidation of liquidationsObject) {
        if (liquidation.disputed) {
          // sponsor and disputer should only withdraw if the liquidation was disputed

          await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, {
            from: liquidation.sponsor,
          });

          await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, { from: disputer });
        }

        // the liquidator should always try withdraw, even if disputed
        await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, { from: liquidator });
      }
    }

    // STEP 9): expire the contract and settle positions
    console.log("Advancing time and settling contract");
    await expiringMultiParty.setCurrentTime(expirationTime.toNumber() + 1);
    await mockOracle.setCurrentTime(expirationTime.toNumber() + 1);

    await expiringMultiParty.expire();

    // After expiration the oracle needs to settle the price. Push a price of 1 usd per collateral means that each
    // token is redeemable for 1 unit of underlying.
    const oracleTime = await expiringMultiParty.getCurrentTime();
    await mockOracle.pushPrice(constructorParams.priceFeedIdentifier, oracleTime.subn(1).toString(), settlementPrice);

    // STEP 10): all users withdraw their funds
    // Settle the liquidator
    await expiringMultiParty.settleExpired({ from: liquidator });
    assert.equal(await syntheticToken.balanceOf(liquidator), "0");

    // Settle the disputer
    await expiringMultiParty.settleExpired({ from: disputer });
    assert.equal(await syntheticToken.balanceOf(disputer), "0");

    // Settle token holders
    for (const tokenHolder of tokenHolders) {
      await expiringMultiParty.settleExpired({ from: tokenHolder });
      assert.equal(await syntheticToken.balanceOf(tokenHolder), "0");
    }

    // Settle token sponsors
    for (const sponsor of sponsors) {
      await expiringMultiParty.settleExpired({ from: sponsor });
      assert.equal(await syntheticToken.balanceOf(sponsor), "0");
    }

    const finalBalanceDrift = await collateralToken.balanceOf(expiringMultiParty.address);
    const finalBalanceDriftFrac = finalBalanceDrift.mul(toBN(toWei("100"))).div(maxCollateralLocked);

    console.log("All accounts have been able to withdraw without revert!");
    console.table({
      iterations: numIterations,
      positionsCreated: positionsCreated,
      tokensTransferred: tokenTransfers,
      additionalDepositsMade: depositsMade,
      redemptionsMade: redemptionsMade,
      liquidations: liquidationsObject.length,
      disputedLiquidations: liquidationsObject.filter((liquidation) => liquidation.disputed).length,
      finalBalanceDrift: finalBalanceDrift.toNumber(),
      driftAsFracOfTotalDeposit: finalBalanceDriftFrac.toString() + " e-18 %",
    });

    // STEP 11): ensure all funds were taken from the contract.
    // However due to drift from the unfriendly numbers we cant assert this! print the error in the output table.
  });

  it("Iterative full life cycle test with unfriendly numbers and efficient liquidator seeding", async function () {
    // This test follows the exact same pattern as before except the input params are less friendly
    // and the liquidator is not seeded before hand. Rather, the liquidator creates a position right
    // before creating the liquidation. In this way all positions within the contract hold similar size
    // without one massive sponsor soaking up all the errors.

    // Test settings
    const numIterations = 10; // number of times the simulation loop is run
    const runLiquidations = true; // if liquidations should occur in the loop
    const runDisputes = true; // if disputes should occur in the loop
    const runExtraDeposits = true; // if the sponsor should have a chance to add more
    const runRedeemTokens = true; // if the sponsor should have a chance to redeem some of their tokens

    // Tunable parameters
    const baseNumTokens = toBN(toWei("99.333333333333333333")); // starting number of tokens created by sponsor
    const settlementPrice = toBN(toWei("1.000000000000000001")); // Price the contract resolves to
    const disputePrice = toBN(toWei("0.999999999999999999")); // Price a dispute will resolve to
    const depositAmount = toBN(toWei("9.999999999999999999")); // Amount of additional collateral to add to a position
    const redeemAmount = toBN(toWei("0.999999999999999999")); // The number of synthetic tokens to redeem for collateral
    const dvmRegularFee = toBN(toWei("0.05")).divn(60 * 60 * 24 * 365); // DVM fee charged per second

    // Counter variables
    let positionsCreated = 0;
    let tokenTransfers = 0;
    let depositsMade = 0;
    let redemptionsMade = 0;
    let liquidationsObject = [];
    let maxCollateralLocked = 0;

    // STEP: 0.a) set the oracle fee
    await store.setFixedOracleFeePerSecondPerPfc({ rawValue: dvmRegularFee.toString() }, { from: contractCreator });

    let sponsor;
    let tokenHolder;
    console.log("Creating positions, liquidations and disputes iteratively\nIteration counter:");
    for (let i = 0; i < numIterations; i++) {
      process.stdout.write(i.toString() + ", ");
      // pick the sponsor and token holder from their arrays
      sponsor = sponsors[i % sponsors.length];
      tokenHolder = tokenHolders[i % tokenHolders.length];

      // STEP 1: creating position
      const tokensOutstanding = await expiringMultiParty.totalTokensOutstanding();
      const rawCollateral = await expiringMultiParty.rawTotalPositionCollateral();

      let GCR;
      if (tokensOutstanding.toString() == "0" || rawCollateral.toString() == "0") {
        console.log("defaultGCR");
        GCR = toBN(toWei("150"));
      } else {
        GCR = rawCollateral.mul(toBN(toWei("1"))).div(tokensOutstanding);
      }

      const collateralNeeded = baseNumTokens
        .mul(GCR)
        .div(toBN(toWei("1")))
        .add(toBN("100000"));

      await expiringMultiParty.create(
        { rawValue: collateralNeeded.toString() },
        { rawValue: baseNumTokens.toString() },
        { from: sponsor }
      );
      positionsCreated++;

      // STEP 2: transferring tokens to the token holder
      if (i % 2 == 1) {
        await syntheticToken.transfer(tokenHolder, baseNumTokens.toString(), { from: sponsor });
        tokenTransfers++;
      }

      // STEP 3: advancing time
      const currentTime = await expiringMultiParty.getCurrentTime();
      await expiringMultiParty.setCurrentTime(currentTime.add(timeOffsetBetweenTests));
      await mockOracle.setCurrentTime(currentTime.add(timeOffsetBetweenTests));

      // STEP 4.a: chance to liquidate position. 1 in 3 will get liquidated
      if (i % 3 == 1 && runLiquidations) {
        const positionTokensOutstanding = toBN(
          (await expiringMultiParty.positions(sponsor)).tokensOutstanding.rawValue
        );

        // STEP: 0.b): seed liquidator with the exact amount that they require to create the liquidation
        let liquidatorSeedCollateral = positionTokensOutstanding
          .mul(GCR)
          .div(toBN(toWei("1")))
          .add(toBN("100000"));
        await expiringMultiParty.create(
          { rawValue: liquidatorSeedCollateral.toString() },
          { rawValue: positionTokensOutstanding.toString() },
          { from: liquidator }
        );

        await expiringMultiParty.createLiquidation(
          sponsor,
          { rawValue: "0" },
          { rawValue: GCR.toString() },
          { rawValue: positionTokensOutstanding.toString() },
          unreachableDeadline,
          { from: liquidator }
        );

        // get the liquidation info from the event. Used later on to withdraw by accounts.
        const liquidationEvents = await expiringMultiParty.getPastEvents("LiquidationCreated");
        const liquidationEvent = liquidationEvents[liquidationEvents.length - 1].args;

        liquidationsObject.push({
          sponsor: liquidationEvent.sponsor,
          id: liquidationEvent.liquidationId.toString(),
          disputed: false,
        });

        // STEP 4.b) Chance to dispute the liquidation. 1 in 2 liquidations will get disputed
        if (i % 2 == 1 && runDisputes) {
          // Create the dispute request for the liquidation
          await expiringMultiParty.dispute(liquidationEvent.liquidationId.toString(), liquidationEvent.sponsor, {
            from: disputer,
          });

          // Push a price into the oracle. This will enable resolution later on when the disputer
          // calls `withdrawLiquidation` to extract their winnings.
          const liquidationTime = await expiringMultiParty.getCurrentTime();
          await mockOracle.pushPrice(constructorParams.priceFeedIdentifier, liquidationTime, disputePrice);

          liquidationsObject[liquidationsObject.length - 1].disputed = true;
        }
      } else {
        // STEP 5): chance for the token sponsor to deposit more collateral
        if (i % 2 == 0 && runExtraDeposits) {
          // Wrap the deposit attempt in a try/catch to deal with a liquidated position reverting deposit

          await expiringMultiParty.deposit({ rawValue: depositAmount.toString() }, { from: sponsor });
          depositsMade++;
        }
        // STEP 6): chance for the token sponsor to redeem some collateral
        if (i % 2 == 1 && runRedeemTokens) {
          // Wrap the deposit attempt in a try/catch to deal with a liquidated position reverting deposit

          await expiringMultiParty.redeem({ rawValue: redeemAmount.toString() }, { from: sponsor });
          redemptionsMade++;
        }
      }
    } // exit iteration loop

    maxCollateralLocked = await expiringMultiParty.rawTotalPositionCollateral();
    console.log("max", maxCollateralLocked.toString());

    console.log(
      "\nPosition creation done!\nAdvancing time and withdrawing winnings/losses for sponsor, disputer and liquidator from liquidations and disputes"
    );
    // STEP 8): Before settling the contract the liquidator, disruptor and token sponsors need to withdraw from all
    // liquidation events that occurred. To do this we iterate over all liquidations that happened and attempt to withdraw
    // from the liquidation from all three users(sponsor, disputer and liquidator).
    if (runLiquidations) {
      for (const liquidation of liquidationsObject) {
        if (liquidation.disputed) {
          // sponsor and disputer should only withdraw if the liquidation was disputed

          await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, {
            from: liquidation.sponsor,
          });

          await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, { from: disputer });
        }

        // the liquidator should always try withdraw, even if disputed
        await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, { from: liquidator });
      }
    }

    // STEP 9): expire the contract and settle positions
    console.log("Advancing time and settling contract");
    await expiringMultiParty.setCurrentTime(expirationTime.toNumber() + 1);
    await mockOracle.setCurrentTime(expirationTime.toNumber() + 1);

    await expiringMultiParty.expire();

    // After expiration the oracle needs to settle the price. Push a price of 1 usd per collateral means that each
    // token is redeemable for 1 unit of underlying.
    const oracleTime = await expiringMultiParty.getCurrentTime();
    await mockOracle.pushPrice(constructorParams.priceFeedIdentifier, oracleTime.subn(1).toString(), settlementPrice);

    // STEP 10): all users withdraw their funds
    // Settle the liquidator
    await expiringMultiParty.settleExpired({ from: liquidator });
    assert.equal(await syntheticToken.balanceOf(liquidator), "0");

    // Settle the disputer
    await expiringMultiParty.settleExpired({ from: disputer });
    assert.equal(await syntheticToken.balanceOf(disputer), "0");

    // Settle token holders
    for (const tokenHolder of tokenHolders) {
      await expiringMultiParty.settleExpired({ from: tokenHolder });
      assert.equal(await syntheticToken.balanceOf(tokenHolder), "0");
    }

    // Settle token sponsors
    for (const sponsor of sponsors) {
      await expiringMultiParty.settleExpired({ from: sponsor });
      assert.equal(await syntheticToken.balanceOf(sponsor), "0");
    }

    const finalBalanceDrift = await collateralToken.balanceOf(expiringMultiParty.address);
    const finalBalanceDriftFrac = finalBalanceDrift.mul(toBN(toWei("100"))).div(maxCollateralLocked);

    console.log("All accounts have been able to withdraw without revert!");
    console.table({
      iterations: numIterations,
      positionsCreated: positionsCreated,
      tokensTransferred: tokenTransfers,
      additionalDepositsMade: depositsMade,
      redemptionsMade: redemptionsMade,
      liquidations: liquidationsObject.length,
      disputedLiquidations: liquidationsObject.filter((liquidation) => liquidation.disputed).length,
      finalBalanceDrift: finalBalanceDrift.toNumber(),
      driftAsFracOfTotalDeposit: finalBalanceDriftFrac.toString() + " e-18 %",
    });

    // STEP 11): ensure all funds were taken from the contract.
    // However due to drift from the unfriendly numbers we cant assert this! print the error in the output table.
  });
});
