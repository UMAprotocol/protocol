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
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const MockOracle = artifacts.require("MockOracle");

contract("IntergrationTest", function(accounts) {
  let contractCreator = accounts[0];
  let liquidator = accounts[1];
  let disputer = accounts[2];
  let sponsors = accounts.slice(3, 6); // accounts 3 -> 5
  console.log(sponsors);
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
  const baseCollateralAmount = toBN(toWei("150")); // starting amount of collateral deposited by sponsor
  const baseNumTokens = toBN(toWei("150")); // starting number of tokens created by sponsor
  const timeOffsetBetweenTests = toBN("10000"); // timestep advance between loop iterations
  const settlementPrice = toBN(toWei("1")); // Price the contract resolves to
  const liquidationPrice = toBN(toWei("1.5")); // Price a liquidator will liquidate at
  const disputePrice = toWei(toWei("1")); // Price a dispute will resolve to

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
      priceFeedIdentifier: web3.utils.utf8ToHex("UMATEST"),
      syntheticName: "Test UMA Token",
      syntheticSymbol: "UMATEST",
      liquidationLiveness: "3600",
      collateralRequirement: { rawValue: toWei("1.5") },
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
     * @notice TEST 1
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
    // 5) chance for token holder to deposit more collateral
    // 6) chance for the sponsor to withdraw collateral
    // 7) repeat 1 to 4 `numIterations` times
    // 8) settle contract
    // 9) ensure that all users can withdraw their funds
    // 10) check the contract has no funds left in it

    // Tunable parameters
    let numIterations = 12;
    let runLiquidations = true;
    let runDisputes = true;

    // STEP: 0: seed liquidator and disruptor
    await expiringMultiParty.create(
      { rawValue: baseCollateralAmount.mul(toBN("100")).toString() },
      { rawValue: baseNumTokens.mul(toBN("100")).toString() },
      { from: liquidator }
    );

    let sponsor;
    let tokenHolder;
    for (let i = 0; i < numIterations; i++) {
      sponsor = sponsors[i % sponsors.length];
      tokenHolder = tokenHolders[i % tokenHolders.length];

      // STEP 1: creating position
      await expiringMultiParty.create(
        { rawValue: baseCollateralAmount.toString() },
        { rawValue: baseNumTokens.toString() },
        { from: sponsor }
      );
      console.log(
        "Position created for sponsor 👩‍💻",
        sponsor,
        "with collateral:",
        baseCollateralAmount.add(toBN(i.toString())).toString()
      );

      // STEP 2: transferring tokens to the token holder
      await syntheticToken.transfer(tokenHolder, toWei("100"), { from: sponsor });

      // STEP 3: advancing time
      const currentTime = await expiringMultiParty.getCurrentTime();
      await expiringMultiParty.setCurrentTime(currentTime.add(timeOffsetBetweenTests));
      await mockOracle.setCurrentTime(currentTime.add(timeOffsetBetweenTests));

      // STEP 4.a: chance to liquidate position. 1 in 3 will get liquidated
      if (i % 3 == 1 && runLiquidations) {
        const positionTokensOutstanding = (await expiringMultiParty.positions(sponsor)).tokensOutstanding;
        console.log("--->liquidating sponsor", sponsor);
        await expiringMultiParty.createLiquidation(
          sponsor, // Price the contract resolves to
          { rawValue: liquidationPrice.toString() }, // Price a liquidator will liquidate at // liquidation at a price of 1.5 per token // Price a dispute will resolve to
          { rawValue: positionTokensOutstanding.toString() },
          { from: liquidator }
        );

        // STEP 4.b) chance to dispute the liquidation. 1 in 2 liquidations will get disputed
        if (i % 2 == 1 && runDisputes) {
          console.log("--->Disputing position");

          // get the liquidation info from the emited event
          const liquidationEvents = await expiringMultiParty.getPastEvents("LiquidationCreated");
          const liquidationEvent = liquidationEvents[liquidationEvents.length - 1].args;

          // Create the dispute request for the liquidation
          await expiringMultiParty.dispute(liquidationEvent.liquidationId.toString(), liquidationEvent.sponsor, {
            from: disputer
          });

          // Push a price into the oracle. This will enable resolution later on when the disputer
          // calls `withdrawLiquidation` to extract their winnings.
          const liquidationTime = await expiringMultiParty.getCurrentTime();
          console.log("Liquidation time", liquidationTime.toString());
          await mockOracle.pushPrice(constructorParams.priceFeedIdentifier, liquidationTime, disputePrice);
        }
      }

      console.log("***time***");
      console.log("startingTime\t\t", startingTime.toString());
      console.log("getCurrentTime\t\t", (await expiringMultiParty.getCurrentTime()).toString());
      console.log("lastPaymentTime\t\t", (await expiringMultiParty.lastPaymentTime()).toString());
      console.log("expirationTimestamp\t", (await expiringMultiParty.expirationTimestamp()).toString());
    } // exit iteration loop

    console.log("Position creation done! advancing time and withdrawing");

    // Before settling the contract the liquidator, disruptor and token sponsors need to withdraw from all
    // liquidation events that occurred.
    if (runLiquidations) {
      for (const sponsor of sponsors) {
        for (let i = 0; i < numIterations / 3; i++) {
          try {
            await expiringMultiParty.withdrawLiquidation(i, sponsor, { from: sponsor });
            console.log("###withdrawl for sponsor passed @", i, sponsor);
          } catch (error) {
            console.log("withdrawl for sponsor invalid @", i, sponsor);
          }
          try {
            await expiringMultiParty.withdrawLiquidation(i, sponsor, {
              from: disputer
            });
            console.log("###withdrawl for disputer passed @", i, sponsor);
          } catch (error) {
            console.log("withdrawl for disputer invalid @", i, sponsor);
          }
          try {
            await expiringMultiParty.withdrawLiquidation(i, sponsor, {
              from: liquidator
            });
            console.log("###withdrawl for liquidator passed @", i, sponsor);
          } catch (error) {
            console.log("withdrawl for liquidator invalid @", i, sponsor);
          }
        }
      }
    }

    // STEP 6: expire the contract and settle positions
    await expiringMultiParty.setCurrentTime(expirationTime.toNumber() + 1);
    await mockOracle.setCurrentTime(expirationTime.toNumber() + 1);

    console.log("***time***");
    console.log("startingTime\t\t", startingTime.toString());
    console.log("getCurrentTime\t\t", (await expiringMultiParty.getCurrentTime()).toString());
    console.log("lastPaymentTime\t\t", (await expiringMultiParty.lastPaymentTime()).toString());
    console.log("expirationTimestamp\t", (await expiringMultiParty.expirationTimestamp()).toString());
    console.log("mockOracleTime", (await mockOracle.getCurrentTime()).toString());

    console.log("###State", (await expiringMultiParty.contractState()).toString());

    await expiringMultiParty.expire();

    // After expiration the oracle needs to settle the price. Push a price of 1 usd per collateral means that each
    // token is redeemable for 1 unit of underlying.
    const oracleTime = await expiringMultiParty.getCurrentTime();
    await mockOracle.pushPrice(constructorParams.priceFeedIdentifier, oracleTime.subn(1).toString(), settlementPrice);

    // Settle the liquidator
    console.log("settleExpired for liquidator", liquidator);
    await expiringMultiParty.settleExpired({ from: liquidator });

    // Settle the disputer
    console.log("settleExpired for disputer", disputer);
    await expiringMultiParty.settleExpired({ from: disputer });

    // Settle token holders
    for (const tokenHolder of tokenHolders) {
      console.log("settleExpired for tokenHolder", tokenHolder);
      await expiringMultiParty.settleExpired({ from: tokenHolder });
      assert.equal(await syntheticToken.balanceOf(tokenHolder), "0");
    }

    // Settle token sponsors
    for (const sponsor of sponsors) {
      console.log("settleExpired for sponsor", sponsor);
      await expiringMultiParty.settleExpired({ from: sponsor });
      assert.equal(await syntheticToken.balanceOf(sponsor), "0");
    }

    assert.equal((await collateralToken.balanceOf(expiringMultiParty.address)).toString(), "0");
  });
});
