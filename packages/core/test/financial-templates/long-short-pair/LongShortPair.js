const { toWei, utf8ToHex, toBN, padRight } = web3.utils;
const truffleAssert = require("truffle-assertions");
const { assert } = require("chai");

// Libraries and helpers
const { interfaceName, didContractThrow, MAX_UINT_VAL, ZERO_ADDRESS, ConvertDecimals } = require("@uma/common");

// Tested Contract
const LongShortPair = artifacts.require("LongShortPair");
const LongShortPairFinancialProjectLibraryTest = artifacts.require("LongShortPairFinancialProjectLibraryTest");

// Helper contracts
const AddressWhitelist = artifacts.require("AddressWhitelist");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const OptimisticOracle = artifacts.require("OptimisticOracle");
const Token = artifacts.require("ExpandedERC20");

// Contracts
let collateralToken;
let longToken;
let shortToken;
let longShortPair;
let longShortPairTestLibrary;
let collateralWhitelist;
let identifierWhitelist;
let optimisticOracle;
let finder;
let customAncillaryData = web3.utils.utf8ToHex("some-address-field:0x1234");
let timer;
let constructorParams;

let optimisticOracleLivenessTime = 7200;
let optimisticOracleProposerBond = "0";

const startTimestamp = Math.floor(Date.now() / 1000);
const expirationTimestamp = startTimestamp + 10000;
const priceIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const collateralPerPair = toWei("1"); // each pair of long and short tokens need 1 unit of collateral to mint.
const prepaidProposerReward = toWei("100");
const pairName = "Long Short Pair Test";

const proposeAndSettleOptimisticOraclePrice = async (priceIdentifier, requestTime, price) => {
  await optimisticOracle.proposePrice(longShortPair.address, priceIdentifier, requestTime, customAncillaryData, price);
  await optimisticOracle.setCurrentTime((await optimisticOracle.getCurrentTime()) + optimisticOracleLivenessTime);
  await optimisticOracle.settle(longShortPair.address, priceIdentifier, requestTime, customAncillaryData);
};

contract("LongShortPair", function (accounts) {
  const deployer = accounts[0];
  const sponsor = accounts[1];
  const holder = accounts[2];

  before(async () => {
    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceIdentifier, { from: deployer });
  });

  beforeEach(async function () {
    // Force each test to start with a simulated time that's synced to the startTimestamp.
    await timer.setCurrentTime(startTimestamp);

    collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: deployer });
    await collateralToken.addMember(1, deployer, { from: deployer });
    await collateralToken.mint(sponsor, toWei("1000"), { from: deployer });

    await collateralWhitelist.addToWhitelist(collateralToken.address);

    longToken = await Token.new("Long Token", "lTKN", 18, { from: deployer });
    shortToken = await Token.new("Short Token", "sTKN", 18, { from: deployer });

    optimisticOracle = await OptimisticOracle.new(optimisticOracleLivenessTime, finder.address, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.address, {
      from: deployer,
    });

    // Create LSP library and LSP contract.
    longShortPairTestLibrary = await LongShortPairFinancialProjectLibraryTest.new();

    constructorParams = {
      pairName,
      expirationTimestamp,
      collateralPerPair,
      priceIdentifier,
      longToken: longToken.address,
      shortToken: shortToken.address,
      collateralToken: collateralToken.address,
      financialProductLibrary: longShortPairTestLibrary.address,
      customAncillaryData,
      prepaidProposerReward,
      optimisticOracleLivenessTime,
      optimisticOracleProposerBond,
      finder: finder.address,
      timerAddress: timer.address,
    };

    longShortPair = await LongShortPair.new(constructorParams);
    await collateralToken.mint(longShortPair.address, toWei("100"));

    // Add mint and burn roles for the long and short tokens to the long short pair.
    await longToken.addMember(1, longShortPair.address, { from: deployer });
    await shortToken.addMember(1, longShortPair.address, { from: deployer });
    await longToken.addMember(2, longShortPair.address, { from: deployer });
    await shortToken.addMember(2, longShortPair.address, { from: deployer });
  });
  describe("Basic Functionality", () => {
    it("Constructor params are set correctly", async function () {
      assert.equal(await longShortPair.pairName(), pairName);
      assert.equal(await longShortPair.expirationTimestamp(), expirationTimestamp);
      assert.equal(await longShortPair.collateralPerPair(), collateralPerPair);
      assert.equal(await longShortPair.priceIdentifier(), priceIdentifier);
      assert.equal(await longShortPair.collateralToken(), collateralToken.address);
      assert.equal(await longShortPair.longToken(), longToken.address);
      assert.equal(await longShortPair.longToken(), longToken.address);
      assert.equal(await longShortPair.finder(), finder.address);
      assert.equal(await longShortPair.financialProductLibrary(), longShortPairTestLibrary.address);
      assert.equal(await longShortPair.customAncillaryData(), customAncillaryData);
      assert.equal(await longShortPair.prepaidProposerReward(), prepaidProposerReward);
      assert.equal(await longShortPair.optimisticOracleLivenessTime(), optimisticOracleLivenessTime);
      assert.equal(await longShortPair.optimisticOracleProposerBond(), optimisticOracleProposerBond);
    });
    it("Rejects invalid constructor parameters", async function () {
      // Invalid expiration time.
      assert(
        await didContractThrow(
          LongShortPair.new({ ...constructorParams, expirationTimestamp: (await timer.getCurrentTime()) - 1 })
        )
      );

      // Invalid collateral per pair.
      assert(await didContractThrow(LongShortPair.new({ ...constructorParams, collateralPerPair: "0" })));

      // Invalid price identifier time.
      assert(await didContractThrow(LongShortPair.new({ ...constructorParams, priceIdentifier: "BAD-IDENTIFIER" })));
      // Invalid LSP library address.
      assert(
        await didContractThrow(LongShortPair.new({ ...constructorParams, financialProductLibrary: ZERO_ADDRESS }))
      );

      // Invalid Finder address.
      assert(await didContractThrow(LongShortPair.new({ ...constructorParams, finder: ZERO_ADDRESS })));

      // Test ancillary data limits.
      // Get max length from contract.
      const maxLength = (await optimisticOracle.ancillaryBytesLimit()).toNumber();

      // Remove the OO bytes
      const ooAncillary = await optimisticOracle.stampAncillaryData("0x", web3.utils.randomHex(20));
      const remainingLength = maxLength - (ooAncillary.length - 2) / 2; // Remove the 0x and divide by 2 to get bytes.
      assert(
        await didContractThrow(
          LongShortPair.new({ ...constructorParams, customAncillaryData: web3.utils.randomHex(remainingLength + 1) })
        )
      );
    });
    it("Mint, redeem, expire lifecycle", async function () {
      // Create some sponsor tokens. Send half to the holder account.
      assert.equal(await collateralToken.balanceOf(sponsor), toWei("1000"));
      assert.equal(await longToken.balanceOf(sponsor), toWei("0"));
      assert.equal(await shortToken.balanceOf(sponsor), toWei("0"));

      await collateralToken.approve(longShortPair.address, MAX_UINT_VAL, { from: sponsor });
      await longShortPair.create(toWei("100"), { from: sponsor });

      // Collateral should have decreased by tokensMinted/collateral per token. Long & short should have increase by tokensMinted.
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), toWei("900")); // 1000 starting balance - 100 for mint.
      assert.equal(await longToken.balanceOf(sponsor), toWei("100"));
      assert.equal(await shortToken.balanceOf(sponsor), toWei("100"));

      // Send half the long tokens to the holder. This would happen by the holder buying them on a dex.
      await longToken.transfer(holder, toWei("50"), { from: sponsor });

      // Token sponsor redeems half their remaining long tokens, along with the associated short tokens.
      await longShortPair.redeem(toWei("25"), { from: sponsor });

      // Sponsor should have 25 remaining long tokens and 75 remaining short tokens. They should have been refunded 25 collateral.
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), toWei("925")); // 900 after mint + 25 redeemed.
      assert.equal(await longToken.balanceOf(sponsor), toWei("25"));
      assert.equal(await shortToken.balanceOf(sponsor), toWei("75"));

      // holder should not be able to call redeem as they only have the long token and redemption requires a pair.
      assert(await didContractThrow(longShortPair.redeem(toWei("25"), { from: holder })));

      // Advance past the expiry timestamp and settle the contract.
      await timer.setCurrentTime(expirationTimestamp + 1);

      assert.equal(await longShortPair.contractState(), 0); // state should be Open before.
      await longShortPair.expire();
      assert.equal(await longShortPair.contractState(), 1); // state should be ExpiredPriceRequested before.

      await proposeAndSettleOptimisticOraclePrice(priceIdentifier, expirationTimestamp, toWei("0.5"));

      // Redemption value scaled between 0 and 1, indicating how much of the collateralPerPair is split between the long and
      // short tokens. Setting to 0.5 makes each long token worth 0.5 collateral and each short token worth 0.5 collateral.
      await longShortPairTestLibrary.setValueToReturn(toWei("0.5"));

      await longShortPair.settle(toWei("50"), toWei("0"), { from: holder }); // holder redeem their 50 long tokens.
      assert.equal(await longToken.balanceOf(holder), toWei("0")); // they should have no long tokens left.
      assert.equal((await collateralToken.balanceOf(holder)).toString(), toWei("25")); // they should have gotten 0.5 collateral per synthetic.

      // Sponsor redeem remaining tokens. They return the remaining 25 long and 75 short. Each should be redeemable for 0.5 collateral.
      await longShortPair.settle(toWei("25"), toWei("75"), { from: sponsor });

      assert.equal(await longToken.balanceOf(sponsor), toWei("0"));
      assert.equal(await longToken.balanceOf(sponsor), toWei("0"));
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), toWei("975")); // 925 after redemption + 12.5 redeemed for long and 37.5 for short.

      // long short pair should have no collateral left in it as everything has been redeemed.
      assert.equal((await collateralToken.balanceOf(longShortPair.address)).toString(), toWei("0"));
    });
    it("Events are correctly emitted", async function () {
      await collateralToken.approve(longShortPair.address, MAX_UINT_VAL, { from: sponsor });
      const createTx = await longShortPair.create(toWei("100"), { from: sponsor });

      truffleAssert.eventEmitted(createTx, "TokensCreated", (ev) => {
        return ev.sponsor == sponsor && ev.collateralUsed == toWei("100") && ev.tokensMinted == toWei("100");
      });

      const redeemTx = await longShortPair.redeem(toWei("25"), { from: sponsor });

      truffleAssert.eventEmitted(redeemTx, "TokensRedeemed", (ev) => {
        return ev.sponsor == sponsor && ev.collateralReturned == toWei("25") && ev.tokensRedeemed == toWei("25");
      });

      // Advance past the expiry timestamp and settle the contract.
      await timer.setCurrentTime(expirationTimestamp + 1);

      const expireTx = await longShortPair.expire();

      truffleAssert.eventEmitted(expireTx, "ContractExpired", (ev) => {
        return ev.caller == deployer;
      });

      await proposeAndSettleOptimisticOraclePrice(priceIdentifier, expirationTimestamp, toWei("0.5"));

      await longShortPairTestLibrary.setValueToReturn(toWei("0.5"));

      const settleTx = await longShortPair.settle(toWei("75"), toWei("75"), { from: sponsor });

      truffleAssert.eventEmitted(settleTx, "PositionSettled", (ev) => {
        return (
          ev.sponsor == sponsor &&
          ev.collateralReturned == toWei("75") &&
          ev.longTokens == toWei("75") &&
          ev.shortTokens == toWei("75")
        );
      });
    });
    it("Ancillary data is correctly set in the OO", async function () {
      await timer.setCurrentTime(expirationTimestamp + 1);
      await longShortPair.expire();
      const request = await optimisticOracle.getRequest(
        longShortPair.address,
        priceIdentifier,
        expirationTimestamp,
        customAncillaryData
      );

      assert.equal(request.currency, collateralToken.address);
    });
  });
  describe("Settlement Functionality", () => {
    // Create a position, advance time, expire contract and propose price. Manually set different expiryPercentLong values
    // using the test longShortPairTestLibrary that bypass the OO return value so we dont need to test the lib here.
    let sponsorCollateralBefore;
    beforeEach(async () => {
      await collateralToken.approve(longShortPair.address, MAX_UINT_VAL, { from: sponsor });
      await longShortPair.create(toWei("100"), { from: sponsor });
      await timer.setCurrentTime(expirationTimestamp + 1);
      await longShortPair.expire();
      await proposeAndSettleOptimisticOraclePrice(priceIdentifier, expirationTimestamp, toWei("0.5"));
      sponsorCollateralBefore = await collateralToken.balanceOf(sponsor);
    });
    it("expiryPercentLong = 1 should give all collateral to long tokens", async function () {
      await longShortPairTestLibrary.setValueToReturn(toWei("1"));

      // Redeeming only short tokens should send 0 collateral as the short tokens are worthless.
      await longShortPair.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), sponsorCollateralBefore.toString());

      // Redeeming the long tokens should send the full amount of collateral to the sponsor.
      await longShortPair.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal(
        (await collateralToken.balanceOf(sponsor)).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiryPercentLong = 0 should give all collateral to short tokens", async function () {
      await longShortPairTestLibrary.setValueToReturn(toWei("0"));
      // Redeeming only long tokens should send 0 collateral as the long tokens are worthless.
      await longShortPair.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), sponsorCollateralBefore.toString());

      // Redeeming the short tokens should send the full amount of collateral to the sponsor.
      await longShortPair.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal(
        (await collateralToken.balanceOf(sponsor)).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiryTokensForCollateral > 1 should ceil to 1", async function () {
      // anything above 1 for the expiryPercentLong is nonsensical and the LSP should act as if it's set to 1.
      await longShortPairTestLibrary.setValueToReturn(toWei("1.5"));

      // Redeeming long short tokens should send no collateral.
      await longShortPair.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), sponsorCollateralBefore.toString());

      // Redeeming long tokens should send all the collateral.
      await longShortPair.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal(
        (await collateralToken.balanceOf(sponsor)).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiryPercentLong = 0.25 should give 25% to long and 75% to short", async function () {
      await longShortPairTestLibrary.setValueToReturn(toWei("0.25"));

      // Redeeming long tokens should send 25% of the collateral.
      await longShortPair.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal(
        (await collateralToken.balanceOf(sponsor)).toString(),
        sponsorCollateralBefore.add(toBN(toWei("25"))).toString()
      );
      const sponsorCollateralAfterLongRedeem = await collateralToken.balanceOf(sponsor);

      // Redeeming short tokens should send the remaining 75% of the collateral.
      await longShortPair.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal(
        (await collateralToken.balanceOf(sponsor)).toString(),
        sponsorCollateralAfterLongRedeem.add(toBN(toWei("75"))).toString()
      );
    });
    it("Cannot settle more tokens than in wallet", async function () {
      // Sponsor only has 100 long and 100 short. anything more than this should revert.
      assert(await didContractThrow(longShortPair.settle(toWei("110"), toWei("100"), { from: sponsor })));
    });
    it("prepaidProposerReward was correctly set/transferred in the OptimisticOracle", async function () {
      // Deployer should have received a proposal reward.
      assert.equal((await collateralToken.balanceOf(deployer)).toString(), prepaidProposerReward);
      // Request should have the reward encoded.
      assert.equal(
        (
          await optimisticOracle.getRequest(
            longShortPair.address,
            priceIdentifier,
            expirationTimestamp,
            customAncillaryData
          )
        ).reward.toString(),
        toWei("100")
      );
    });
  });
  describe("Contract States", () => {
    beforeEach(async () => {
      await collateralToken.approve(longShortPair.address, MAX_UINT_VAL, { from: sponsor });
      await longShortPair.create(toWei("100"), { from: sponsor });
    });
    it("Can not expire pre expirationTimestamp", async function () {
      assert(await didContractThrow(longShortPair.expire()));
      assert(await didContractThrow(longShortPair.settle(toWei("100"), toWei("100"), { from: sponsor })));
    });
    it("Can not create or redeem post expiry", async function () {
      await timer.setCurrentTime(expirationTimestamp + 1);
      assert(await didContractThrow(longShortPair.create(toWei("100"))), { from: sponsor });
      assert(await didContractThrow(longShortPair.redeem(toWei("100"))), { from: sponsor });
    });
    it("Can not settle before price returned from OO", async function () {
      // Set time after expiration, add a price to OO but dont pass OO liveness.
      await timer.setCurrentTime(expirationTimestamp + 1);
      await longShortPair.expire();
      await optimisticOracle.proposePrice(
        longShortPair.address,
        priceIdentifier,
        expirationTimestamp,
        customAncillaryData,
        toWei("0.5")
      );
      assert(await didContractThrow(longShortPair.settle(toWei("100"), toWei("100"), { from: sponsor })));
    });
  });
  describe("Non-standard ERC20 Decimals", () => {
    const convertDecimals = ConvertDecimals(0, 6, this.web3);
    beforeEach(async () => {
      collateralToken = await Token.new("USD Coin", "USDC", 6, { from: deployer });
      await collateralToken.addMember(1, deployer, { from: deployer });
      await collateralToken.mint(sponsor, convertDecimals("1000"), { from: deployer });

      await collateralWhitelist.addToWhitelist(collateralToken.address);

      longToken = await Token.new("Long Token", "lTKN", 6, { from: deployer });
      shortToken = await Token.new("Short Token", "sTKN", 6, { from: deployer });

      constructorParams = {
        ...constructorParams,
        longToken: longToken.address,
        shortToken: shortToken.address,
        collateralToken: collateralToken.address,
        prepaidProposerReward: convertDecimals("100").toString(),
      };

      longShortPair = await LongShortPair.new(constructorParams);
      await collateralToken.mint(longShortPair.address, convertDecimals("100"));

      // Add mint and burn roles for the long and short tokens to the long short pair.
      await longToken.addMember(1, longShortPair.address, { from: deployer });
      await shortToken.addMember(1, longShortPair.address, { from: deployer });
      await longToken.addMember(2, longShortPair.address, { from: deployer });
      await shortToken.addMember(2, longShortPair.address, { from: deployer });
    });
    it("Mint, redeem, expire lifecycle", async function () {
      // Create some sponsor tokens. Send half to the holder account.
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), convertDecimals("1000").toString());
      assert.equal((await longToken.balanceOf(sponsor)).toString(), convertDecimals("0").toString());
      assert.equal((await shortToken.balanceOf(sponsor)).toString(), convertDecimals("0").toString());

      await collateralToken.approve(longShortPair.address, MAX_UINT_VAL, { from: sponsor });
      await longShortPair.create(convertDecimals("100"), { from: sponsor });

      // Collateral should have decreased by tokensMinted/collateral per token. Long & short should have increase by tokensMinted.
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), convertDecimals("900").toString()); // 1000 starting balance - 100 for mint.
      assert.equal((await longToken.balanceOf(sponsor)).toString(), convertDecimals("100").toString());
      assert.equal((await shortToken.balanceOf(sponsor)).toString(), convertDecimals("100").toString());

      // Send half the long tokens to the holder. This would happen by the holder buying them on a dex.
      await longToken.transfer(holder, convertDecimals("50"), { from: sponsor });

      // Token sponsor redeems half their remaining long tokens, along with the associated short tokens.
      await longShortPair.redeem(convertDecimals("25"), { from: sponsor });

      // Sponsor should have 25 remaining long tokens and 75 remaining short tokens. They should have been refunded 25 collateral.
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), convertDecimals("925").toString()); // 900 after mint + 25 redeemed.
      assert.equal((await longToken.balanceOf(sponsor)).toString(), convertDecimals("25").toString());
      assert.equal((await shortToken.balanceOf(sponsor)).toString(), convertDecimals("75").toString());

      // holder should not be able to call redeem as they only have the long token and redemption requires a pair.
      assert(await didContractThrow(longShortPair.redeem(convertDecimals("25"), { from: holder })));

      // Advance past the expiry timestamp and settle the contract.
      await timer.setCurrentTime(expirationTimestamp + 1);

      assert.equal(await longShortPair.contractState(), 0); // state should be Open before.
      await longShortPair.expire();
      assert.equal(await longShortPair.contractState(), 1); // state should be ExpiredPriceRequested before.

      // Note that this proposal is scaled by 1e18. Prices returned from the DVM are scaled independently of the contract decimals.
      await proposeAndSettleOptimisticOraclePrice(priceIdentifier, expirationTimestamp, toWei("0.5"));

      // Redemption value scaled between 0 and 1, indicating how much of the collateralPerPair is split between the long and
      // short tokens. Setting to 0.5 makes each long token worth 0.5 collateral and each short token worth 0.5 collateral.
      // Note that this value is still scaled by 1e18 as this lib is independent of decimals.
      await longShortPairTestLibrary.setValueToReturn(toWei("0.5"));

      await longShortPair.settle(convertDecimals("50"), convertDecimals("0"), { from: holder }); // holder redeem their 50 long tokens.
      assert.equal((await longToken.balanceOf(holder)).toString(), convertDecimals("0")); // they should have no long tokens left.
      assert.equal((await collateralToken.balanceOf(holder)).toString(), convertDecimals("25")); // they should have gotten 0.5 collateral per synthetic.

      // Sponsor redeem remaining tokens. They return the remaining 25 long and 75 short. Each should be redeemable for 0.5 collateral.
      await longShortPair.settle(convertDecimals("25"), convertDecimals("75"), { from: sponsor });

      assert.equal((await longToken.balanceOf(sponsor)).toString(), convertDecimals("0").toString());
      assert.equal((await longToken.balanceOf(sponsor)).toString(), convertDecimals("0").toString());
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), convertDecimals("975").toString()); // 925 after redemption + 12.5 redeemed for long and 37.5 for short.

      // long short pair should have no collateral left in it as everything has been redeemed.
      assert.equal((await collateralToken.balanceOf(longShortPair.address)).toString(), convertDecimals("0"));
    });
  });
  describe("Custom OO parameterization", () => {
    beforeEach(async () => {
      optimisticOracleLivenessTime = 3600; // set to one hour. the default for the OO is two hours (7200 seconds).
      optimisticOracleProposerBond = toWei("1"); // the proposer will now need to provide 1e18 collateral as a bond.

      constructorParams = { ...constructorParams, optimisticOracleLivenessTime, optimisticOracleProposerBond };

      longShortPair = await LongShortPair.new(constructorParams);
      await collateralToken.mint(longShortPair.address, toWei("100"));

      // Add mint and burn roles for the long and short tokens to the long short pair.
      await longToken.addMember(1, longShortPair.address, { from: deployer });
      await shortToken.addMember(1, longShortPair.address, { from: deployer });
      await longToken.addMember(2, longShortPair.address, { from: deployer });
      await shortToken.addMember(2, longShortPair.address, { from: deployer });
    });
    it("Custom OO settings are correctly set", async function () {
      assert.equal(await longShortPair.optimisticOracleLivenessTime(), optimisticOracleLivenessTime);
      assert.equal(await longShortPair.optimisticOracleProposerBond(), optimisticOracleProposerBond);

      // Create some tokens from sponsor wallet.
      await collateralToken.approve(longShortPair.address, MAX_UINT_VAL, { from: sponsor });
      await longShortPair.create(toWei("100"), { from: sponsor });

      // Advance past the expiry timestamp and settle the contract.
      await timer.setCurrentTime(expirationTimestamp + 1);

      assert.equal(await longShortPair.contractState(), 0); // state should be Open before.
      await longShortPair.expire();
      assert.equal(await longShortPair.contractState(), 1); // state should be ExpiredPriceRequested before.

      // Ensure the price request was enqueued correctly and the liveness time and bond was set.
      const request = await optimisticOracle.getRequest(
        longShortPair.address,
        priceIdentifier,
        expirationTimestamp,
        customAncillaryData
      );

      assert.equal(request.currency, collateralToken.address);
      assert.equal(request.settled, false);
      assert.equal(request.proposedPrice, "0");
      assert.equal(request.resolvedPrice, "0");
      assert.equal(request.reward, prepaidProposerReward);
      assert.equal(request.bond, optimisticOracleProposerBond);
      assert.equal(request.customLiveness, optimisticOracleLivenessTime);

      // Proposing a price without approving the proposal bond should revert.
      assert(
        await didContractThrow(
          optimisticOracle.proposePrice(
            longShortPair.address,
            priceIdentifier,
            expirationTimestamp,
            customAncillaryData,
            toWei("0.5"),
            { from: deployer }
          )
        )
      );

      // Approve the OO to pull collateral from the deployer. Mint some collateral to the deployer to pay for bond.
      await collateralToken.approve(optimisticOracle.address, MAX_UINT_VAL, { from: deployer });
      await collateralToken.mint(deployer, toWei("1"), { from: deployer });

      // Now the proposal should go through without revert.
      const deployerBalanceBeforeProposal = await collateralToken.balanceOf(deployer);
      await optimisticOracle.proposePrice(
        longShortPair.address,
        priceIdentifier,
        expirationTimestamp,
        customAncillaryData,
        toWei("0.5"),
        { from: deployer }
      );

      assert.equal(
        deployerBalanceBeforeProposal.sub(await collateralToken.balanceOf(deployer)).toString(),
        optimisticOracleProposerBond
      );

      // Advance time. Should not be able to settle any time before the OO liveness.

      assert(
        await didContractThrow(
          optimisticOracle.settle(longShortPair.address, priceIdentifier, expirationTimestamp, customAncillaryData)
        )
      );

      await optimisticOracle.setCurrentTime((await optimisticOracle.getCurrentTime()) + optimisticOracleLivenessTime);

      const sponsorBalanceBefore = await collateralToken.balanceOf(sponsor);
      const deployerBalanceBeforeSettlement = await collateralToken.balanceOf(deployer);
      await optimisticOracle.settle(longShortPair.address, priceIdentifier, expirationTimestamp, customAncillaryData);

      await longShortPairTestLibrary.setValueToReturn(toWei("0.5"));

      // settle all tokens.
      await longShortPair.settle(toWei("100"), toWei("100"), { from: sponsor }); // sponsor redeem their 100 long tokens.
      assert.equal((await longToken.balanceOf(sponsor)).toString(), toWei("0")); // sponsor should have no long tokens left.
      assert.equal((await shortToken.balanceOf(sponsor)).toString(), toWei("0")); // sponsor should have no short tokens left.
      assert.equal((await collateralToken.balanceOf(sponsor)).sub(sponsorBalanceBefore).toString(), toWei("100")); // sponsor should get back all collateral.

      // OO proposer should get back proposal bond + reward at price request settlement.
      assert.equal(
        (await collateralToken.balanceOf(deployer)).sub(deployerBalanceBeforeSettlement).toString(),
        toBN(optimisticOracleProposerBond).add(toBN(prepaidProposerReward)).toString()
      );
    });
  });
});
