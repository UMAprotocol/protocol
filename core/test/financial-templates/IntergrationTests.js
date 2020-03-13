// This test script runs a number of integration tests between all layers of the smart contracts
// to stress test the contract logic to ensure contract state never locks. For example all branches
// where fees get taken out (positions, liquidations, emergency shutdowns, partial liquidations)
// are tested and to see if there is any leftover wei or whether contracts get locked.

const { toWei, hexToUtf8, toBN } = web3.utils;
const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const truffleAssert = require("truffle-assertions");
const { RegistryRolesEnum } = require("../../../common/Enums.js");

const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const Token = artifacts.require("ExpandedERC20");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const TokenFactory = artifacts.require("TokenFactory");
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const MockOracle = artifacts.require("MockOracle");

contract("IntergrationTest", function(accounts) {
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

  // Re-used variables
  let constructorParams;
  let startingTime;
  let expirationTime;

  /**
   * @notice TUNABLE PARAMETERS
   */
  const mintAndApprove = toBN(toWei("10000000")); // number of tokens minted and approved by each account
  const timeOffsetBetweenTests = toBN("10000"); // timestep advance between loop iterations

  beforeEach(async () => {
    collateralToken = await Token.new({ from: contractCreator });
    await collateralToken.addMember(1, contractCreator, {
      from: contractCreator
    });
    registry = await Registry.deployed();
    expiringMultiPartyCreator = await ExpiringMultiPartyCreator.deployed();
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address, {
      from: contractCreator
    });

    collateralTokenWhitelist = await AddressWhitelist.at(await expiringMultiPartyCreator.collateralTokenWhitelist());
    await collateralTokenWhitelist.addToWhitelist(collateralToken.address, {
      from: contractCreator
    });

    startingTime = await expiringMultiPartyCreator.getCurrentTime();
    expirationTime = startingTime.add(toBN(60 * 60 * 24 * 30));
    constructorParams = {
      isTest: true,
      expirationTimestamp: expirationTime.toString(),
      withdrawalLiveness: "3600",
      collateralAddress: collateralToken.address,
      finderAddress: Finder.address,
      tokenFactoryAddress: TokenFactory.address,
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      liquidationLiveness: "3600",
      collateralRequirement: { rawValue: toWei("1.2") },
      disputeBondPct: { rawValue: toWei("0.1") },
      sponsorDisputeRewardPct: { rawValue: toWei("0.1") },
      disputerDisputeRewardPct: { rawValue: toWei("0.1") }
    };

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(constructorParams.priceFeedIdentifier, {
      from: contractCreator
    });

    // Create a mockOracle and get the deployed finder. Register the mockMoracle with the finder.
    mockOracle = await MockOracle.new(identifierWhitelist.address, {
      from: contractCreator
    });
    finder = await Finder.deployed();

    await finder.changeImplementationAddress(web3.utils.utf8ToHex("Oracle"), mockOracle.address, {
      from: contractCreator
    });

    expiringMultiParty = await ExpiringMultiParty.new(constructorParams);

    syntheticToken = await Token.at(await expiringMultiParty.tokenCurrency());

    for (const account of accounts) {
      // approve the tokens
      await collateralToken.approve(expiringMultiParty.address, mintAndApprove, {
        from: account
      });
      await syntheticToken.approve(expiringMultiParty.address, mintAndApprove, {
        from: account
      });

      // mint collateral for all accounts
      await collateralToken.mint(account, mintAndApprove, { from: contractCreator });
    }
  });
  it("Iterative sponsor, liquidation and withdrawal tests", async function() {
    /**
     * @notice Iterative test with sponsors, liquidations and disputes.
     */
    // Number of positions to create and liquidate. The following process is followed to initiate maximum interaction
    // with the emp & fee paying function to try and compound floating errors to see if positions are locked at settlement:
    // 0) create a large position by the liquidator to enable them to perform liquidations
    // 1) position created by selected sponsor
    // 2) random amount of tokens sent to a selected tokenholder
    // 3) time advanced by 1000 seconds
    // 4) 1/3 chance to initiate liquidation
    // 4.a) if liquidation initiated then time advanced
    // 4.b) 1/2chance to dispute
    // 4.b.i) if disputed then resolve oracle price
    // 5) chance for token sponsor to deposit more collateral
    // 6) chance for the sponsor to withdraw collateral
    // 7) repeat 1 to 4 `numIterations` times
    // 8) settle contract
    // 9) ensure that all users can withdraw their funds
    // 10) check the contract has no funds left in it

    // Test settings
    const numIterations = 15; // number of times the simulation loop is run
    const runLiquidations = true; // if liquidations should occur in the loop
    const runDisputes = true; // if disputes should occur in the loop
    const runExtraDeposits = true; // if the sponsor should have a chance to add more

    // Tunable parameters
    const baseCollateralAmount = toBN(toWei("150")); // starting amount of collateral deposited by sponsor
    const baseNumTokens = toBN(toWei("100")); // starting number of tokens created by sponsor
    const settlementPrice = toBN(toWei("1")); // Price the contract resolves to
    const liquidationPrice = toBN(toWei("1.5")); // Price a liquidator will liquidate at
    const disputePrice = toBN(toWei("1")); // Price a dispute will resolve to
    const depositAmount = toBN(toWei("10")); // Amount of additional collateral to add to a position

    // Counter variables
    let positionsCreated = 0;
    let tokenTransfers = 0;
    let depositsMade = 0;
    let liquidationsObject = [];

    // STEP: 0: seed liquidator
    console.log("STEP: 0 Seeding liquidator");

    await expiringMultiParty.create(
      { rawValue: baseCollateralAmount.mul(toBN("100")).toString() },
      { rawValue: baseNumTokens.mul(toBN("100")).toString() },
      { from: liquidator }
    );

    let sponsor;
    let tokenHolder;
    console.log("STEP 1: Creating positions, liquidations and disputes iteratively\nIteration counter:");
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
        await syntheticToken.transfer(tokenHolder, toWei("100"), { from: sponsor });
        tokenTransfers++;
      }

      // STEP 3: advancing time
      const currentTime = await expiringMultiParty.getCurrentTime();
      await expiringMultiParty.setCurrentTime(currentTime.add(timeOffsetBetweenTests));
      await mockOracle.setCurrentTime(currentTime.add(timeOffsetBetweenTests));

      // STEP 4.a: chance to liquidate position. 1 in 3 will get liquidated
      if (i % 3 == 1 && runLiquidations) {
        console.log(await expiringMultiParty.positions(sponsor));
        const positionTokensOutstanding = (await expiringMultiParty.positions(sponsor)).tokensOutstanding;
        await expiringMultiParty.createLiquidation(
          sponsor,
          { rawValue: GCR.toString() },
          { rawValue: positionTokensOutstanding.toString() },
          { from: liquidator }
        );

        // get the liquidation info from the event. Used later on to withdraw by accounts.
        const liquidationEvents = await expiringMultiParty.getPastEvents("LiquidationCreated");
        const liquidationEvent = liquidationEvents[liquidationEvents.length - 1].args;

        liquidationsObject.push({
          sponsor: liquidationEvent.sponsor,
          id: liquidationEvent.liquidationId.toString(),
          disputed: false
        });

        // STEP 4.b) Chance to dispute the liquidation. 1 in 2 liquidations will get disputed
        if (i % 2 == 1 && runDisputes) {
          // Create the dispute request for the liquidation
          await expiringMultiParty.dispute(liquidationEvent.liquidationId.toString(), liquidationEvent.sponsor, {
            from: disputer
          });

          // Push a price into the oracle. This will enable resolution later on when the disputer
          // calls `withdrawLiquidation` to extract their winnings.
          const liquidationTime = await expiringMultiParty.getCurrentTime();
          await mockOracle.pushPrice(constructorParams.priceFeedIdentifier, liquidationTime, disputePrice);

          liquidationsObject[liquidationsObject.length - 1].disputed = true;
        }
      }

      // STEP 5: chance for the token sponsor to deposit more collateral
      if (i % 2 == 0 && runExtraDeposits) {
        console.log("depositing more value into position");
        // Wrap the deposit attempt in a try/catch to deal with a liquidated position reverting deposit
        try {
          await expiringMultiParty.deposit({ rawValue: depositAmount.toString() }, { from: sponsor });
          console.log("-> deposit succeeded");
          depositsMade++;
        } catch (error) {
          continue;
        }
      }
    } // exit iteration loop

    console.log(
      "Position creation done!\nAdvancing time and withdrawing winnings/losses for sponsor, disputer and liquidator from liquidations and disputes"
    );
    // Before settling the contract the liquidator, disruptor and token sponsors need to withdraw from all
    // liquidation events that occurred. To do this we iterate over all liquidations that occured and attempt to withdraw
    // from the liquidation from all three users(sponsor, disputer and liquidator).
    console.log("liquidation object");
    console.log(liquidationsObject);
    if (runLiquidations) {
      for (const liquidation of liquidationsObject) {
        if (liquidation.disputed) {
          // sponsor and disputer should only withdraw if the liquidation was disputed
          try {
            await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, {
              from: liquidation.sponsor
            });
          } catch (error) {
            continue;
          }
          try {
            await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, { from: disputer });
          } catch (error) {
            continue;
          }
        }
        try {
          // the liquidator should always try withdraw, even if disputed
          await expiringMultiParty.withdrawLiquidation(liquidation.id, liquidation.sponsor, { from: liquidator });
        } catch (error) {
          continue;
        }
      }
    }

    // STEP 8: expire the contract and settle positions
    console.log("STEP 8: Advancing time and settling contract");
    await expiringMultiParty.setCurrentTime(expirationTime.toNumber() + 1);
    await mockOracle.setCurrentTime(expirationTime.toNumber() + 1);

    await expiringMultiParty.expire();

    // After expiration the oracle needs to settle the price. Push a price of 1 usd per collateral means that each
    // token is redeemable for 1 unit of underlying.
    const oracleTime = await expiringMultiParty.getCurrentTime();
    await mockOracle.pushPrice(constructorParams.priceFeedIdentifier, oracleTime.subn(1).toString(), settlementPrice);

    // Settle the liquidator
    await expiringMultiParty.settleExpired({ from: liquidator });

    // Settle the disputer
    await expiringMultiParty.settleExpired({ from: disputer });

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

    console.table({
      iterations: numIterations,
      positionsCreated: positionsCreated,
      tokensTransferred: tokenTransfers,
      additionalDepositsMade: depositsMade,
      liquidations: liquidationsObject.length,
      disputedLiquidations: liquidationsObject.filter(liquidation => liquidation.disputed).length
    });

    // The main assertion we can check is that all users were able to call `settleExpired` without the contract
    // locking up. Additionally, if all book keeping has gone correctly, there should be no collateral left in
    // the expiring multi party as this has all be withdrawn by token holders.
    assert.equal((await collateralToken.balanceOf(expiringMultiParty.address)).toString(), "0");
  });
});
