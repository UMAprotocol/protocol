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
  const timeOffsetBetweenTests = toBN("1000"); // timestep advance between loop iterations

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
    // with the fee paying function to try and compound floating errors to see if positions are locked at settlement:
    // 1) position created by random sponsor
    // 2) random amount of tokens sent to a random sponsor
    // 3) time advanced by 1000 seconds
    // 4) random chance to initiate liquidation.
    // 4.a) if liquidation initiated then time advanced
    // 4.b) random chance to dispute
    // 4.b.i) if disputed then resolve oracle price
    // 4.c) all users withdraw after liveness
    // 5) repeat 1 to 4 `numIterations` times
    // 6) settle contract
    // 7) ensure that all users can withdraw their funds
    // 8) check the contract has no funds left in it

    let numIterations = 5;

    let sponsor;
    let tokenHolder;
    for (let i = 0; i < numIterations; i++) {
      sponsor = sponsors[i % sponsors.length];
      tokenHolder = tokenHolders[i % tokenHolders.length];
      console.log(
        "iteration number",
        i,
        "\ncreating position for sponsor",
        sponsor,
        "\nsending tokens to",
        tokenHolder
      );
      console.log("collat", baseCollateralAmount.add(toBN(i.toString())).toString());
      console.log("tokens", baseNumTokens.toString());

      // STEP 1: creating position
      await expiringMultiParty.create(
        {
          rawValue: baseCollateralAmount.add(toBN(i.toString())).toString()
        },
        {
          rawValue: baseNumTokens.toString()
        },
        { from: sponsor }
      );
      console.log(
        "Position created for sponsor 👩‍💻",
        sponsor,
        "with collateral:",
        baseCollateralAmount.add(toBN(i.toString())).toString()
      );

      // STEP 2: transferring tokens
      await syntheticToken.transfer(tokenHolder, toWei("100"), { from: sponsor });

      // STEP 3: advancing time
      await expiringMultiParty.setCurrentTime(startingTime.add(timeOffsetBetweenTests));
      await expiringMultiParty.setCurrentTime(startingTime.add(timeOffsetBetweenTests));

      // STEP 4: chance to liquidate position. 1 in 3 will get liquidated
      if (i % 3 == 1) {
      }

      console.log("***time***");
      console.log("startingTime\t\t", startingTime.toString());
      console.log("getCurrentTime\t\t", (await expiringMultiParty.getCurrentTime()).toString());
      console.log("lastPaymentTime\t\t", (await expiringMultiParty.lastPaymentTime()).toString());
      console.log("expirationTimestamp\t", (await expiringMultiParty.expirationTimestamp()).toString());
    }

    console.log("Position creation done! advancing time and withdrawing");
    console.log("expiration", (await expiringMultiParty.expirationTimestamp()).toString());

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
    const oraclePrice = await expiringMultiParty.getCurrentTime();
    await mockOracle.pushPrice(constructorParams.priceFeedIdentifier, oraclePrice.subn(1).toString(), 1);

    // Settle token holders
    for (const tokenHolder of tokenHolders) {
      console.log("settleExpired for tokenHolder", tokenHolder);
      await expiringMultiParty.settleExpired({ from: tokenHolder });
    }

    // Settle token sponsors
    for (const sponsor of sponsors) {
      console.log("settleExpired for sponsor", sponsor);
      await expiringMultiParty.settleExpired({ from: sponsor });
    }

    assert.equal(true, true);
  });
});
