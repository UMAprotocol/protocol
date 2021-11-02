const hre = require("hardhat");
const { web3 } = hre;
const { getContract, assertEventEmitted } = hre;
const { toWei, fromWei, utf8ToHex, toBN, padRight } = web3.utils;
const { assert } = require("chai");

// Libraries and helpers
const {
  interfaceName,
  didContractThrow,
  MAX_UINT_VAL,
  MIN_INT_VALUE,
  ZERO_ADDRESS,
  ConvertDecimals,
} = require("@uma/common");

// Tested Contract
const LongShortPair = getContract("LongShortPair");
const LongShortPairFinancialProjectLibraryTest = getContract("LongShortPairFinancialProjectLibraryTest");

// Helper contracts
const AddressWhitelist = getContract("AddressWhitelist");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Finder = getContract("Finder");
const Store = getContract("Store");
const Timer = getContract("Timer");
const OptimisticOracle = getContract("OptimisticOracle");
const Token = getContract("ExpandedERC20");

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
let rawUnencodedAncillaryData = "some-address-field:0x1234";
let customAncillaryData = web3.utils.utf8ToHex(rawUnencodedAncillaryData);
let timer;
let constructorParams;
let store;

let optimisticOracleLivenessTime = 7200;
let optimisticOracleProposerBond = "0";
let proposerReward = toWei("100"); // set to zero. test directly later.

const startTimestamp = Math.floor(Date.now() / 1000);
const expirationTimestamp = startTimestamp + 10000;
const priceIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const collateralPerPair = toWei("1"); // each pair of long and short tokens need 1 unit of collateral to mint.
const pairName = "Long Short Pair Test";

describe("LongShortPair", function () {
  let accounts;
  let deployer;
  let sponsor;
  let holder;
  let rando;

  const proposeAndSettleOptimisticOraclePrice = async (
    price,
    requestTime,
    ancillaryData = customAncillaryData,
    identifier = priceIdentifier
  ) => {
    await optimisticOracle.methods
      .proposePrice(longShortPair.options.address, identifier, requestTime, ancillaryData, price)
      .send({ from: deployer });
    await optimisticOracle.methods
      .setCurrentTime(parseInt(await optimisticOracle.methods.getCurrentTime().call()) + optimisticOracleLivenessTime)
      .send({ from: deployer });
    await optimisticOracle.methods
      .settle(longShortPair.options.address, identifier, requestTime, ancillaryData)
      .send({ from: deployer });
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, sponsor, holder, rando] = accounts;
    timer = await Timer.new().send({ from: deployer });
    finder = await Finder.new().send({ from: deployer });
    collateralWhitelist = await AddressWhitelist.new().send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.CollateralWhitelist), collateralWhitelist.options.address)
      .send({ from: deployer });

    identifierWhitelist = await IdentifierWhitelist.new().send({ from: deployer });
    await identifierWhitelist.methods.addSupportedIdentifier(priceIdentifier).send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.IdentifierWhitelist), identifierWhitelist.options.address)
      .send({ from: deployer });

    store = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: deployer });
  });

  beforeEach(async function () {
    // Force each test to start with a simulated time that's synced to the startTimestamp.
    await timer.methods.setCurrentTime(startTimestamp).send({ from: deployer });

    collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: deployer });
    await collateralToken.methods.addMember(1, deployer).send({ from: deployer });
    await collateralToken.methods.mint(sponsor, toWei("1000")).send({ from: deployer });

    await collateralWhitelist.methods.addToWhitelist(collateralToken.options.address).send({ from: deployer });
    await store.methods.setFinalFee(collateralToken.options.address, { rawValue: toWei("0") }).send({ from: deployer });

    longToken = await Token.new("Long Token", "lTKN", 18).send({ from: deployer });
    shortToken = await Token.new("Short Token", "sTKN", 18).send({ from: deployer });

    optimisticOracle = await OptimisticOracle.new(
      optimisticOracleLivenessTime,
      finder.options.address,
      timer.options.address
    ).send({ from: deployer });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: deployer });

    // Create LSP library and LSP contract.
    longShortPairTestLibrary = await LongShortPairFinancialProjectLibraryTest.new().send({ from: deployer });

    constructorParams = {
      pairName,
      expirationTimestamp,
      collateralPerPair,
      priceIdentifier,
      enableEarlyExpiration: false,
      longToken: longToken.options.address,
      shortToken: shortToken.options.address,
      collateralToken: collateralToken.options.address,
      financialProductLibrary: longShortPairTestLibrary.options.address,
      customAncillaryData,
      proposerReward,
      optimisticOracleLivenessTime,
      optimisticOracleProposerBond,
      finder: finder.options.address,
      timerAddress: timer.options.address,
    };

    longShortPair = await LongShortPair.new(constructorParams).send({ from: deployer });

    // Add mint and burn roles for the long and short tokens to the long short pair.
    await longToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
    await shortToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
    await longToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
    await shortToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });

    // Mint tokens to the deployer to pay for the proposer reward when calling expire.
    await collateralToken.methods.mint(deployer, proposerReward).send({ from: deployer });
    await collateralToken.methods.approve(longShortPair.options.address, proposerReward).send({ from: deployer });
  });
  describe("Basic Functionality", () => {
    it("Constructor params are set correctly", async function () {
      assert.equal(await longShortPair.methods.expirationTimestamp().call(), expirationTimestamp);
      assert.equal(await longShortPair.methods.pairName().call(), pairName);
      assert.equal(await longShortPair.methods.collateralPerPair().call(), collateralPerPair);
      assert.equal(await longShortPair.methods.priceIdentifier().call(), priceIdentifier);
      assert.equal(await longShortPair.methods.collateralToken().call(), collateralToken.options.address);
      assert.equal(await longShortPair.methods.longToken().call(), longToken.options.address);
      assert.equal(await longShortPair.methods.longToken().call(), longToken.options.address);
      assert.equal(await longShortPair.methods.finder().call(), finder.options.address);
      assert.equal(
        await longShortPair.methods.financialProductLibrary().call(),
        longShortPairTestLibrary.options.address
      );
      assert.equal(await longShortPair.methods.customAncillaryData().call(), customAncillaryData);
      assert.equal(await longShortPair.methods.proposerReward().call(), proposerReward);
      assert.equal(await longShortPair.methods.optimisticOracleLivenessTime().call(), optimisticOracleLivenessTime);
      assert.equal(await longShortPair.methods.optimisticOracleProposerBond().call(), optimisticOracleProposerBond);
      assert.equal(await longShortPair.methods.enableEarlyExpiration().call(), false);
    });
    it("Rejects invalid constructor parameters", async function () {
      // Invalid expiration time.
      assert(
        await didContractThrow(
          LongShortPair.new({
            ...constructorParams,
            expirationTimestamp: parseInt(await timer.methods.getCurrentTime().call()) - 1,
          }).send({ from: deployer })
        )
      );

      // Invalid collateral per pair.
      assert(
        await didContractThrow(
          LongShortPair.new({ ...constructorParams, collateralPerPair: "0" }).send({ from: deployer })
        )
      );

      // Invalid price identifier time.
      assert(
        await didContractThrow(
          LongShortPair.new({ ...constructorParams, priceIdentifier: padRight(utf8ToHex("BAD-IDENTIFIER"), 64) }).send({
            from: deployer,
          })
        )
      );
      // Invalid LSP library address.
      assert(
        await didContractThrow(
          LongShortPair.new({ ...constructorParams, financialProductLibrary: ZERO_ADDRESS }).send({ from: deployer })
        )
      );

      // Invalid Finder address.
      assert(
        await didContractThrow(
          LongShortPair.new({ ...constructorParams, finder: ZERO_ADDRESS }).send({ from: deployer })
        )
      );

      // Test ancillary data limits.
      // Get max length from contract.
      const maxLength = parseInt(await optimisticOracle.methods.ancillaryBytesLimit().call());

      // Remove the OO bytes
      const ooAncillary = await optimisticOracle.methods.stampAncillaryData("0x", web3.utils.randomHex(20)).call();
      const remainingLength = maxLength - (ooAncillary.length - 2) / 2; // Remove the 0x and divide by 2 to get bytes.
      assert(
        await didContractThrow(
          LongShortPair.new({ ...constructorParams, customAncillaryData: web3.utils.randomHex(remainingLength) }).send({
            from: deployer,
          })
        )
      );

      // Right below the size limit should work.
      await LongShortPair.new({
        ...constructorParams,
        customAncillaryData: web3.utils.randomHex(remainingLength - 1),
      }).send({ from: deployer });

      // If the contract is set to enable early expiration, should have a more strict ancillary data size limit
      // to factor in the additional appended ancillary data for this kind of expiration.

      assert(
        await didContractThrow(
          LongShortPair.new({
            ...constructorParams,
            enableEarlyExpiration: true,
            customAncillaryData: web3.utils.randomHex(remainingLength - 1),
          }).send({ from: deployer })
        )
      );

      // Subtracting the additional appended data length should enable deployment.
      await LongShortPair.new({
        ...constructorParams,
        enableEarlyExpiration: true,
        customAncillaryData: web3.utils.randomHex(remainingLength - "earlyExpiration: 1".length - 1),
      }).send({ from: deployer });
    });
    it("Mint, redeem, expire lifecycle", async function () {
      // Create some sponsor tokens. Send half to the holder account.
      assert.equal(await collateralToken.methods.balanceOf(sponsor).call(), toWei("1000"));
      assert.equal(await longToken.methods.balanceOf(sponsor).call(), toWei("0"));
      assert.equal(await shortToken.methods.balanceOf(sponsor).call(), toWei("0"));

      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await longShortPair.methods.create(toWei("100")).send({ from: sponsor });

      // Collateral should have decreased by tokensMinted/collateral per token. Long & short should have increase by tokensMinted.
      assert.equal((await collateralToken.methods.balanceOf(sponsor).call()).toString(), toWei("900")); // 1000 starting balance - 100 for mint.
      assert.equal(await longToken.methods.balanceOf(sponsor).call(), toWei("100"));
      assert.equal(await shortToken.methods.balanceOf(sponsor).call(), toWei("100"));

      // Send half the long tokens to the holder. This would happen by the holder buying them on a dex.
      await longToken.methods.transfer(holder, toWei("50")).send({ from: sponsor });

      // Token sponsor redeems half their remaining long tokens, along with the associated short tokens.
      await longShortPair.methods.redeem(toWei("25")).send({ from: sponsor });

      // Sponsor should have 25 remaining long tokens and 75 remaining short tokens. They should have been refunded 25 collateral.
      assert.equal((await collateralToken.methods.balanceOf(sponsor).call()).toString(), toWei("925")); // 900 after mint + 25 redeemed.
      assert.equal(await longToken.methods.balanceOf(sponsor).call(), toWei("25"));
      assert.equal(await shortToken.methods.balanceOf(sponsor).call(), toWei("75"));

      // holder should not be able to call redeem as they only have the long token and redemption requires a pair.
      assert(await didContractThrow(longShortPair.methods.redeem(toWei("25")).send({ from: holder })));

      // Advance past the expiry timestamp and settle the contract.
      await timer.methods.setCurrentTime(expirationTimestamp + 1).send({ from: deployer });
      await longShortPair.methods.expire().send({ from: deployer });

      // subsequent calls to expire should revert
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: deployer })));

      await proposeAndSettleOptimisticOraclePrice(toWei("0.5"), expirationTimestamp);

      // Equally, after there is a settlement price calling settle again should revert
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: deployer })));

      // Redemption value scaled between 0 and 1, indicating how much of the collateralPerPair is split between the long and
      // short tokens. Setting to 0.5 makes each long token worth 0.5 collateral and each short token worth 0.5 collateral.
      await longShortPairTestLibrary.methods.setValueToReturn(toWei("0.5")).send({ from: deployer });

      assert.isFalse(await longShortPair.methods.receivedSettlementPrice().call());
      await longShortPair.methods.settle(toWei("50"), toWei("0")).send({ from: holder }); // holder redeem their 50 long tokens.
      assert.isTrue(await longShortPair.methods.receivedSettlementPrice().call());
      assert.equal(await longToken.methods.balanceOf(holder).call(), toWei("0")); // they should have no long tokens left.
      assert.equal((await collateralToken.methods.balanceOf(holder).call()).toString(), toWei("25")); // they should have gotten 0.5 collateral per synthetic.

      // Sponsor redeem remaining tokens. They return the remaining 25 long and 75 short. Each should be redeemable for 0.5 collateral.
      await longShortPair.methods.settle(toWei("25"), toWei("75")).send({ from: sponsor });

      assert.equal(await longToken.methods.balanceOf(sponsor).call(), toWei("0"));
      assert.equal(await longToken.methods.balanceOf(sponsor).call(), toWei("0"));
      assert.equal((await collateralToken.methods.balanceOf(sponsor).call()).toString(), toWei("975")); // 925 after redemption + 12.5 redeemed for long and 37.5 for short.

      // long short pair should have no collateral left in it as everything has been redeemed.
      assert.equal(
        (await collateralToken.methods.balanceOf(longShortPair.options.address).call()).toString(),
        toWei("0")
      );
    });
    it("Events are correctly emitted", async function () {
      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      const createTx = await longShortPair.methods.create(toWei("100")).send({ from: sponsor });

      await assertEventEmitted(createTx, longShortPair, "TokensCreated", (ev) => {
        return ev.sponsor == sponsor && ev.collateralUsed == toWei("100") && ev.tokensMinted == toWei("100");
      });

      const redeemTx = await longShortPair.methods.redeem(toWei("25")).send({ from: sponsor });

      await assertEventEmitted(redeemTx, longShortPair, "TokensRedeemed", (ev) => {
        return ev.sponsor == sponsor && ev.collateralReturned == toWei("25") && ev.tokensRedeemed == toWei("25");
      });

      // Advance past the expiry timestamp and settle the contract.
      await timer.methods.setCurrentTime(expirationTimestamp + 1).send({ from: deployer });

      const expireTx = await longShortPair.methods.expire().send({ from: deployer });

      await assertEventEmitted(expireTx, longShortPair, "ContractExpired", (ev) => {
        return ev.caller == deployer;
      });

      await proposeAndSettleOptimisticOraclePrice(toWei("0.5"), expirationTimestamp);

      await longShortPairTestLibrary.methods.setValueToReturn(toWei("0.5")).send({ from: deployer });

      const settleTx = await longShortPair.methods.settle(toWei("75"), toWei("75")).send({ from: sponsor });

      await assertEventEmitted(settleTx, longShortPair, "PositionSettled", (ev) => {
        return (
          ev.sponsor == sponsor &&
          ev.collateralReturned == toWei("75") &&
          ev.longTokens == toWei("75") &&
          ev.shortTokens == toWei("75")
        );
      });
    });
    it("Ancillary data is correctly set in the OO", async function () {
      await timer.methods.setCurrentTime(expirationTimestamp + 1).send({ from: deployer });
      await longShortPair.methods.expire().send({ from: deployer });
      const request = await optimisticOracle.methods
        .getRequest(longShortPair.options.address, priceIdentifier, expirationTimestamp, customAncillaryData)
        .call();

      assert.equal(request.currency, collateralToken.options.address);
    });
  });
  describe("Settlement Functionality", () => {
    // Create a position, advance time, expire contract and propose price. Manually set different expiryPercentLong values
    // using the test longShortPairTestLibrary that bypass the OO return value so we dont need to test the lib here.
    let sponsorCollateralBefore;
    beforeEach(async () => {
      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await longShortPair.methods.create(toWei("100")).send({ from: sponsor });
      await timer.methods.setCurrentTime(expirationTimestamp + 1).send({ from: deployer });
      await longShortPair.methods.expire().send({ from: deployer });
      await proposeAndSettleOptimisticOraclePrice(toWei("0.5"), expirationTimestamp);
      sponsorCollateralBefore = toBN(await collateralToken.methods.balanceOf(sponsor).call());
    });
    it("expiryPercentLong = 1 should give all collateral to long tokens", async function () {
      await longShortPairTestLibrary.methods.setValueToReturn(toWei("1")).send({ from: deployer });

      // Redeeming only short tokens should send 0 collateral as the short tokens are worthless.
      await longShortPair.methods.settle(toWei("0"), toWei("100")).send({ from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.toString()
      );

      // Redeeming the long tokens should send the full amount of collateral to the sponsor.
      await longShortPair.methods.settle(toWei("100"), toWei("0")).send({ from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiryPercentLong = 0 should give all collateral to short tokens", async function () {
      await longShortPairTestLibrary.methods.setValueToReturn(toWei("0")).send({ from: deployer });
      // Redeeming only long tokens should send 0 collateral as the long tokens are worthless.
      await longShortPair.methods.settle(toWei("100"), toWei("0")).send({ from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.toString()
      );

      // Redeeming the short tokens should send the full amount of collateral to the sponsor.
      await longShortPair.methods.settle(toWei("0"), toWei("100")).send({ from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiryTokensForCollateral > 1 should ceil to 1", async function () {
      // anything above 1 for the expiryPercentLong is nonsensical and the LSP should act as if it's set to 1.
      await longShortPairTestLibrary.methods.setValueToReturn(toWei("1.5")).send({ from: deployer });

      // Redeeming long short tokens should send no collateral.
      await longShortPair.methods.settle(toWei("0"), toWei("100")).send({ from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.toString()
      );

      // Redeeming long tokens should send all the collateral.
      await longShortPair.methods.settle(toWei("100"), toWei("0")).send({ from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiryPercentLong = 0.25 should give 25% to long and 75% to short", async function () {
      await longShortPairTestLibrary.methods.setValueToReturn(toWei("0.25")).send({ from: deployer });

      // Redeeming long tokens should send 25% of the collateral.
      await longShortPair.methods.settle(toWei("100"), toWei("0")).send({ from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.add(toBN(toWei("25"))).toString()
      );
      const sponsorCollateralAfterLongRedeem = toBN(await collateralToken.methods.balanceOf(sponsor).call());

      // Redeeming short tokens should send the remaining 75% of the collateral.
      await longShortPair.methods.settle(toWei("0"), toWei("100")).send({ from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralAfterLongRedeem.add(toBN(toWei("75"))).toString()
      );
    });
    it("Cannot settle more tokens than in wallet", async function () {
      // Sponsor only has 100 long and 100 short. anything more than this should revert.
      assert(await didContractThrow(longShortPair.methods.settle(toWei("110"), toWei("100")).send({ from: sponsor })));
    });
    it("proposerReward was correctly set/transferred in the OptimisticOracle", async function () {
      // Deployer should have received a proposal reward.
      assert.equal((await collateralToken.methods.balanceOf(deployer).call()).toString(), proposerReward);
      // Request should have the reward encoded.
      assert.equal(
        (
          await optimisticOracle.methods
            .getRequest(longShortPair.options.address, priceIdentifier, expirationTimestamp, customAncillaryData)
            .call()
        ).reward.toString(),
        proposerReward
      );
    });
  });
  describe("Contract States", () => {
    beforeEach(async () => {
      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await longShortPair.methods.create(toWei("100")).send({ from: sponsor });
    });
    it("Can not call requestEarlyExpiration if disabled", async function () {
      assert(
        await didContractThrow(
          longShortPair.methods.requestEarlyExpiration(expirationTimestamp - 10).send({ from: deployer })
        )
      );
    });
    it("Can not expire pre expirationTimestamp", async function () {
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: deployer })));
      assert(await didContractThrow(longShortPair.methods.settle(toWei("100"), toWei("100")).send({ from: sponsor })));
    });
    it("Can not create post expiry", async function () {
      await timer.methods.setCurrentTime(expirationTimestamp + 1).send({ from: deployer });
      assert(await didContractThrow(longShortPair.methods.create(toWei("100")).send({ from: sponsor })));
    });
    it("Can not settle before price returned from OO", async function () {
      // Set time after expiration, add a price to OO but dont pass OO liveness.
      await timer.methods.setCurrentTime(expirationTimestamp + 1).send({ from: deployer });
      await longShortPair.methods.expire().send({ from: deployer });
      await optimisticOracle.methods
        .proposePrice(
          longShortPair.options.address,
          priceIdentifier,
          expirationTimestamp,
          customAncillaryData,
          toWei("0.5")
        )
        .send({ from: deployer });
      assert(await didContractThrow(longShortPair.methods.settle(toWei("100"), toWei("100")).send({ from: sponsor })));
    });
  });
  describe("Non-standard ERC20 Decimals", () => {
    const convertDecimals = ConvertDecimals(0, 6, web3);
    beforeEach(async () => {
      collateralToken = await Token.new("USD Coin", "USDC", 6).send({ from: deployer });
      await collateralToken.methods.addMember(1, deployer).send({ from: deployer });
      await collateralToken.methods.mint(sponsor, convertDecimals("1000")).send({ from: deployer });

      await collateralWhitelist.methods.addToWhitelist(collateralToken.options.address).send({ from: deployer });

      longToken = await Token.new("Long Token", "lTKN", 6).send({ from: deployer });
      shortToken = await Token.new("Short Token", "sTKN", 6).send({ from: deployer });

      constructorParams = {
        ...constructorParams,
        longToken: longToken.options.address,
        shortToken: shortToken.options.address,
        collateralToken: collateralToken.options.address,
        proposerReward: "0",
      };

      longShortPair = await LongShortPair.new(constructorParams).send({ from: deployer });
      await collateralToken.methods
        .mint(longShortPair.options.address, convertDecimals("100"))
        .send({ from: deployer });

      // Add mint and burn roles for the long and short tokens to the long short pair.
      await longToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
      await shortToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
      await longToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
      await shortToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
    });
    it("Mint, redeem, expire lifecycle", async function () {
      // Create some sponsor tokens. Send half to the holder account.
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        convertDecimals("1000").toString()
      );
      assert.equal((await longToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("0").toString());
      assert.equal((await shortToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("0").toString());

      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await longShortPair.methods.create(convertDecimals("100")).send({ from: sponsor });

      // Collateral should have decreased by tokensMinted/collateral per token. Long & short should have increase by tokensMinted.
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        convertDecimals("900").toString()
      ); // 1000 starting balance - 100 for mint.
      assert.equal((await longToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("100").toString());
      assert.equal((await shortToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("100").toString());

      // Send half the long tokens to the holder. This would happen by the holder buying them on a dex.
      await longToken.methods.transfer(holder, convertDecimals("50")).send({ from: sponsor });

      // Token sponsor redeems half their remaining long tokens, along with the associated short tokens.
      await longShortPair.methods.redeem(convertDecimals("25")).send({ from: sponsor });

      // Sponsor should have 25 remaining long tokens and 75 remaining short tokens. They should have been refunded 25 collateral.
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        convertDecimals("925").toString()
      ); // 900 after mint + 25 redeemed.
      assert.equal((await longToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("25").toString());
      assert.equal((await shortToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("75").toString());

      // holder should not be able to call redeem as they only have the long token and redemption requires a pair.
      assert(await didContractThrow(longShortPair.methods.redeem(convertDecimals("25")).send({ from: holder })));

      // Advance past the expiry timestamp and settle the contract.
      await timer.methods.setCurrentTime(expirationTimestamp + 1).send({ from: deployer });

      await longShortPair.methods.expire().send({ from: deployer });

      // Note that this proposal is scaled by 1e18. Prices returned from the DVM are scaled independently of the contract decimals.
      await proposeAndSettleOptimisticOraclePrice(toWei("0.5"), expirationTimestamp);

      // Redemption value scaled between 0 and 1, indicating how much of the collateralPerPair is split between the long and
      // short tokens. Setting to 0.5 makes each long token worth 0.5 collateral and each short token worth 0.5 collateral.
      // Note that this value is still scaled by 1e18 as this lib is independent of decimals.
      await longShortPairTestLibrary.methods.setValueToReturn(toWei("0.5")).send({ from: deployer });

      await longShortPair.methods.settle(convertDecimals("50"), convertDecimals("0")).send({ from: holder }); // holder redeem their 50 long tokens.
      assert.equal((await longToken.methods.balanceOf(holder).call()).toString(), convertDecimals("0")); // they should have no long tokens left.
      assert.equal((await collateralToken.methods.balanceOf(holder).call()).toString(), convertDecimals("25")); // they should have gotten 0.5 collateral per synthetic.

      // Sponsor redeem remaining tokens. They return the remaining 25 long and 75 short. Each should be redeemable for 0.5 collateral.
      await longShortPair.methods.settle(convertDecimals("25"), convertDecimals("75")).send({ from: sponsor });

      assert.equal((await longToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("0").toString());
      assert.equal((await longToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("0").toString());
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        convertDecimals("975").toString()
      ); // 925 after redemption + 12.5 redeemed for long and 37.5 for short.

      // long short pair should have no collateral left in it as everything has been redeemed.
      assert.equal(
        (await collateralToken.methods.balanceOf(longShortPair.options.address).call()).toString(),
        convertDecimals(fromWei(proposerReward)).toString()
      );
    });
  });
  describe("Custom OO parameterization", () => {
    beforeEach(async () => {
      optimisticOracleLivenessTime = 3600; // set to one hour. the default for the OO is two hours (7200 seconds).
      optimisticOracleProposerBond = toWei("1"); // the proposer will now need to provide 1e18 collateral as a bond.

      constructorParams = { ...constructorParams, optimisticOracleLivenessTime, optimisticOracleProposerBond };

      longShortPair = await LongShortPair.new(constructorParams).send({ from: deployer });
      await collateralToken.methods.mint(longShortPair.options.address, toWei("100")).send({ from: deployer });

      // Add mint and burn roles for the long and short tokens to the long short pair.
      await longToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
      await shortToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
      await longToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
      await shortToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
    });
    it("Custom OO settings are correctly set", async function () {
      assert.equal(await longShortPair.methods.optimisticOracleLivenessTime().call(), optimisticOracleLivenessTime);
      assert.equal(await longShortPair.methods.optimisticOracleProposerBond().call(), optimisticOracleProposerBond);

      // Create some tokens from sponsor wallet.
      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await longShortPair.methods.create(toWei("100")).send({ from: sponsor });

      // Advance past the expiry timestamp and settle the contract.
      await timer.methods.setCurrentTime(expirationTimestamp + 1).send({ from: deployer });

      // Mint some tokens to the deployer  to pay for the proposer reward.
      await collateralToken.methods.mint(deployer, proposerReward).send({ from: deployer });
      await collateralToken.methods.approve(longShortPair.options.address, proposerReward).send({ from: deployer });
      await longShortPair.methods.expire().send({ from: deployer });

      // Ensure the price request was enqueued correctly and the liveness time and bond was set.
      const request = await optimisticOracle.methods
        .getRequest(longShortPair.options.address, priceIdentifier, expirationTimestamp, customAncillaryData)
        .call();

      assert.equal(request.currency, collateralToken.options.address);
      assert.equal(request.settled, false);
      assert.equal(request.proposedPrice, "0");
      assert.equal(request.resolvedPrice, "0");
      assert.equal(request.reward, proposerReward);
      assert.equal(request.bond, optimisticOracleProposerBond);
      assert.equal(request.customLiveness, optimisticOracleLivenessTime);

      // Proposing a price without approving the proposal bond should revert.
      assert(
        await didContractThrow(
          optimisticOracle.methods
            .proposePrice(
              longShortPair.options.address,
              priceIdentifier,
              expirationTimestamp,
              customAncillaryData,
              toWei("0.5")
            )
            .send({ from: deployer })
        )
      );

      // Approve the OO to pull collateral from the deployer. Mint some collateral to the deployer to pay for bond.
      await collateralToken.methods.approve(optimisticOracle.options.address, MAX_UINT_VAL).send({ from: deployer });
      await collateralToken.methods.mint(deployer, toWei("1")).send({ from: deployer });

      // Now the proposal should go through without revert.
      const deployerBalanceBeforeProposal = toBN(await collateralToken.methods.balanceOf(deployer).call());
      await optimisticOracle.methods
        .proposePrice(
          longShortPair.options.address,
          priceIdentifier,
          expirationTimestamp,
          customAncillaryData,
          toWei("0.5")
        )
        .send({ from: deployer });

      assert.equal(
        deployerBalanceBeforeProposal.sub(toBN(await collateralToken.methods.balanceOf(deployer).call())).toString(),
        optimisticOracleProposerBond
      );

      // Advance time. Should not be able to settle any time before the OO liveness.
      assert(
        await didContractThrow(
          optimisticOracle.methods
            .settle(longShortPair.options.address, priceIdentifier, expirationTimestamp, customAncillaryData)
            .send({ from: deployer })
        )
      );

      await optimisticOracle.methods
        .setCurrentTime(parseInt(await optimisticOracle.methods.getCurrentTime().call()) + optimisticOracleLivenessTime)
        .send({ from: deployer });

      const sponsorBalanceBefore = toBN(await collateralToken.methods.balanceOf(sponsor).call());
      const deployerBalanceBeforeSettlement = toBN(await collateralToken.methods.balanceOf(deployer).call());
      await optimisticOracle.methods
        .settle(longShortPair.options.address, priceIdentifier, expirationTimestamp, customAncillaryData)
        .send({ from: deployer });

      await longShortPairTestLibrary.methods.setValueToReturn(toWei("0.5")).send({ from: deployer });

      // settle all tokens.
      await longShortPair.methods.settle(toWei("100"), toWei("100")).send({ from: sponsor }); // sponsor redeem their 100 long tokens.
      assert.equal((await longToken.methods.balanceOf(sponsor).call()).toString(), toWei("0")); // sponsor should have no long tokens left.
      assert.equal((await shortToken.methods.balanceOf(sponsor).call()).toString(), toWei("0")); // sponsor should have no short tokens left.
      assert.equal(
        toBN(await collateralToken.methods.balanceOf(sponsor).call())
          .sub(sponsorBalanceBefore)
          .toString(),
        toWei("100")
      ); // sponsor should get back all collateral.

      // OO proposer should get back proposal bond + reward at price request settlement.
      assert.equal(
        toBN(await collateralToken.methods.balanceOf(deployer).call())
          .sub(deployerBalanceBeforeSettlement)
          .toString(),
        toBN(optimisticOracleProposerBond).add(toBN(proposerReward)).toString()
      );
    });
  });
  describe("Dust and rounding is dealt with correctly", () => {
    beforeEach(async () => {
      // Set the collateral per pair to some small number to try induce rounding on mint/redeem settings.
      constructorParams = {
        ...constructorParams,
        optimisticOracleProposerBond: 0,
        collateralPerPair: toWei("0.0000001"),
      };

      longShortPair = await LongShortPair.new(constructorParams).send({ from: deployer });

      // Mint some tokens to the deployer to pay for the proposer reward.
      await collateralToken.methods.mint(deployer, proposerReward).send({ from: deployer });
      await collateralToken.methods.approve(longShortPair.options.address, proposerReward).send({ from: deployer });

      // Add mint and burn roles for the long and short tokens to the long short pair.
      await longToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
      await shortToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
      await longToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
      await shortToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
    });
    it("Should not be able to mint dust tokens for free", async function () {
      // Try mint a tiny amount of tokens (1 wei worth) from an account that has 0 balance of collateral and 0 approval.
      assert.equal((await collateralToken.methods.balanceOf(rando).call()).toString(), "0");
      assert(await didContractThrow(longShortPair.methods.create("1").send({ from: rando })));
      assert.equal((await longToken.methods.balanceOf(rando).call()).toString(), "0");
      assert.equal((await shortToken.methods.balanceOf(rando).call()).toString(), "0");
    });
    it("Should not be able to redeem dust for free collateral", async function () {
      // Try redeem a tiny amount of tokens (1 wei worth) from an account that never minted any.
      assert.equal((await longToken.methods.balanceOf(rando).call()).toString(), "0");
      assert.equal((await shortToken.methods.balanceOf(rando).call()).toString(), "0");
      assert(await didContractThrow(longShortPair.methods.redeem("1").send({ from: rando })));
      assert.equal((await collateralToken.methods.balanceOf(rando).call()).toString(), "0");
    });

    it("Redeeming dust should round to 0 collateral returned", async function () {
      // In the case the caller actually has some synthetic tokens and they redeem dust they should get back nothing.
      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await longShortPair.methods.create(toWei("100")).send({ from: sponsor });

      const sponsorCollateralBefore = await collateralToken.methods.balanceOf(sponsor).call();
      await longShortPair.methods.redeem("1").send({ from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.toString()
      );
    });

    // approve collateral, mint tokens, expire LSP contract and set the library expiryPercentLong to return.
    const approveCreateExpireLsp = async (tokensToCreate, expiryPercentLong) => {
      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await longShortPair.methods.create(tokensToCreate).send({ from: sponsor });

      await timer.methods.setCurrentTime(expirationTimestamp + 1).send({ from: deployer });
      await longShortPair.methods.expire().send({ from: deployer });
      await proposeAndSettleOptimisticOraclePrice(toWei("0.5"), expirationTimestamp);

      await longShortPairTestLibrary.methods.setValueToReturn(expiryPercentLong).send({ from: deployer });
    };
    it("Settling dust long tokens should round to 0 with collateral 0 expiryPercentLong", async function () {
      await approveCreateExpireLsp(toWei("100"), toWei("0"));
      const sponsorCollateralBefore = await collateralToken.methods.balanceOf(sponsor).call();
      await longShortPair.methods.settle("1", "0").send({ from: sponsor }); // holder redeem their 50 long tokens.
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.toString()
      );
    });
    it("Settling dust short tokens should round to 0 with collateral 0 expiryPercentLong", async function () {
      await approveCreateExpireLsp(toWei("100"), toWei("0"));
      const sponsorCollateralBefore = await collateralToken.methods.balanceOf(sponsor).call();
      await longShortPair.methods.settle("0", "1").send({ from: sponsor }); // holder redeem their 50 long tokens.
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.toString()
      );
    });
    it("Settling dust long tokens should round to 0 with collateral 1 expiryPercentLong", async function () {
      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await approveCreateExpireLsp(toWei("100"), toWei("1"));

      const sponsorCollateralBefore = await collateralToken.methods.balanceOf(sponsor).call();
      await longShortPair.methods.settle("1", "0").send({ from: sponsor }); // holder redeem their 50 long tokens.
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.toString()
      );
    });
    it("Settling dust short tokens should round to 0 with collateral 1 expiryPercentLong", async function () {
      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await approveCreateExpireLsp(toWei("100"), toWei("1"));

      const sponsorCollateralBefore = await collateralToken.methods.balanceOf(sponsor).call();
      await longShortPair.methods.settle("0", "1").send({ from: sponsor }); // holder redeem their 50 long tokens.
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.toString()
      );
    });
  });
  describe("Early contract expiration", () => {
    let earlyExpirationTimestamp, earlyExpirationAncillaryData;
    beforeEach(async () => {
      // Set the collateral per pair to some small number to try induce rounding on mint/redeem settings.
      constructorParams = {
        ...constructorParams,
        optimisticOracleProposerBond: "0",
        proposerReward: "0",
        enableEarlyExpiration: true,
      };

      longShortPair = await LongShortPair.new(constructorParams).send({ from: deployer });

      // Add mint and burn roles for the long and short tokens to the long short pair.
      await longToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
      await shortToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
      await longToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
      await shortToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });

      // Create some tokens from the sponsors wallet
      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await longShortPair.methods.create(toWei("100")).send({ from: sponsor });

      // Advance time but before expiration timestamp.
      await timer.methods
        .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + 500)
        .send({ from: deployer });

      // Some time in the past before expiration.
      earlyExpirationTimestamp = Number(await timer.methods.getCurrentTime().call()) - 10;

      earlyExpirationAncillaryData = await longShortPair.methods.getEarlyExpirationAncillaryData().call();
    });
    it("Correctly appends early expiration flag to ancillary data", async function () {
      // Check the generated ancillary data for early expiration maps to what is expected. Take the raw ancillary data
      // and append the early expiration key to it.
      assert.equal(earlyExpirationAncillaryData, utf8ToHex(rawUnencodedAncillaryData + ",earlyExpiration:1"));
    });
    it("Can propose an early expiration price and settle", async function () {
      assert.isTrue(await longShortPair.methods.enableEarlyExpiration().call());

      const earlyExpireTx = await longShortPair.methods
        .requestEarlyExpiration(earlyExpirationTimestamp)
        .send({ from: rando });

      // Associated early expiration variables are set correctly.
      assert.equal(await longShortPair.methods.earlyExpirationTimestamp().call(), earlyExpirationTimestamp);

      const ooPriceRequestedEvent = (await optimisticOracle.getPastEvents("RequestPrice", { fromBock: 0 }))[0];

      await assertEventEmitted(earlyExpireTx, longShortPair, "EarlyExpirationRequested", (ev) => {
        return ev.caller === rando && ev.earlyExpirationTimeStamp === earlyExpirationTimestamp.toString();
      });

      assert.equal(earlyExpirationAncillaryData, ooPriceRequestedEvent.returnValues.ancillaryData);

      // Double check that we are actually before the expiration timestamp.
      assert.isTrue(
        Number(await timer.methods.getCurrentTime().call()) <
          Number(await longShortPair.methods.expirationTimestamp().call())
      );

      // Propose a price to the OO for the early settlement.
      await proposeAndSettleOptimisticOraclePrice(
        toWei("0.75"),
        earlyExpirationTimestamp,
        earlyExpirationAncillaryData
      );
      await longShortPairTestLibrary.methods.setValueToReturn(toWei("0.75")).send({ from: deployer });

      // We should still be before the expiration timestamp.
      assert.isTrue(
        Number(await timer.methods.getCurrentTime().call()) <
          Number(await longShortPair.methods.expirationTimestamp().call())
      );

      // Now that there is a price in the OO we should be able to settle a position, even though we are before expiration.
      assert.equal(await collateralToken.methods.balanceOf(sponsor).call(), toWei("900")); // 1000 starting balance - 100 for mint.

      // Settle only the long tokens. should get back 75 units of collateral at the settlement price.
      const settleTx1 = await longShortPair.methods.settle(toWei("100"), toWei("0")).send({ from: sponsor });
      assert.equal(await collateralToken.methods.balanceOf(sponsor).call(), toWei("975")); // 1000-100+75
      await assertEventEmitted(settleTx1, longShortPair, "PositionSettled", (ev) => {
        return (
          ev.sponsor == sponsor &&
          ev.collateralReturned == toWei("75") &&
          ev.longTokens == toWei("100") &&
          ev.shortTokens == toWei("0")
        );
      });
      // Settle the short tokens. should get back 25 units of collateral at the settlement price.
      const settleTx2 = await longShortPair.methods.settle(toWei("0"), toWei("100")).send({ from: sponsor });
      assert.equal(await collateralToken.methods.balanceOf(sponsor).call(), toWei("1000")); // 1000-100+75+25
      await assertEventEmitted(settleTx2, longShortPair, "PositionSettled", (ev) => {
        return (
          ev.sponsor == sponsor &&
          ev.collateralReturned == toWei("25") &&
          ev.longTokens == toWei("0") &&
          ev.shortTokens == toWei("100")
        );
      });

      // Finally, ensure the settlement price in the LSP was set correctly.
      assert.equal(await longShortPair.methods.expiryPrice().call(), toWei("0.75"));
      assert.isTrue(await longShortPair.methods.receivedSettlementPrice().call());
    });

    it("Can not attempt early expiration post expiration", async function () {
      const earlyExpirationTimestamp = Number(await timer.methods.getCurrentTime().call());
      assert(
        await didContractThrow(
          longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp + 10).send({ from: rando })
        )
      );
    });

    it("Can not attempt early expiration with a timestamp of 0", async function () {
      assert(await didContractThrow(longShortPair.methods.requestEarlyExpiration(0).send({ from: rando })));
    });

    it("Optimistic oracle returning 'do nothing' number blocks early expiration", async function () {
      // In the event that someone tried to incorrectly settle the contract early, the OO will return type(int256).min.
      // This indicates that the contract should "do nothing" (i.e keep running).

      await longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp).send({ from: rando });

      // Propose a to the OO that indicates the contract should not settle. price to the OO for the early settlement.
      await proposeAndSettleOptimisticOraclePrice(
        toBN(MIN_INT_VALUE), // Magic number the LSP uses to ignore early expiration settlement actions.
        earlyExpirationTimestamp,
        earlyExpirationAncillaryData
      );

      // Calling settle should revert as the contract is not in a settable state.
      assert(await didContractThrow(longShortPair.methods.settle(toWei("100"), toWei("100")).send({ from: sponsor })));
    });
    it("Can not re-request early expiration while the previous request is in pending state", async function () {
      // In the event that someone tried to early expire the LSP, the LSP should not alow someone else to re-request
      // early expiration until the first request is done.

      await longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp).send({ from: rando });

      // Requesting again with the same timestamp should fail.
      assert(
        await didContractThrow(
          longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp).send({ from: rando })
        )
      );

      // Requesting with a different timestamp (1 second later) should also fail.
      assert(
        await didContractThrow(
          longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp + 1).send({ from: rando })
        )
      );
    });
    it("Can not re-request early expiration if a previous early expiration finalized successfully", async function () {
      // In the event that someone tries to early expire the LSP, which is successful (returns a number other than
      // type(int256).min) future attempts to early expire should be blocked.

      await longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp).send({ from: rando });

      // Propose a valid early expiration price.
      // Propose a to the OO that indicates the contract should not settle. price to the OO for the early settlement.
      await proposeAndSettleOptimisticOraclePrice(
        toWei("10"), // Use a number other than the magic number.
        earlyExpirationTimestamp,
        earlyExpirationAncillaryData
      );

      // Requesting again should fail as the contract already has a price for early expiration that is valid.
      assert(
        await didContractThrow(
          longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp).send({ from: rando })
        )
      );
      assert(
        await didContractThrow(
          longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp + 10).send({ from: rando })
        )
      );
    });
    it("Can re-request early expiration if a previous request failed", async function () {
      // In the event that someone tries to early expire the LSP, which is unsuccessful (OO returns the magic
      // type(int256).min number) future attempts to early expire should be valid, assuming the request timestamp is
      // different to the original request timestamp.

      await longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp).send({ from: rando });

      // Propose a to the OO that indicates the contract should not settle.
      await proposeAndSettleOptimisticOraclePrice(
        toBN(MIN_INT_VALUE), // Magic number the LSP uses to ignore early expiration settlement actions.
        earlyExpirationTimestamp,
        earlyExpirationAncillaryData
      );

      // Requesting again on the same timestamp should fail.
      assert(
        await didContractThrow(
          longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp).send({ from: rando })
        )
      );

      // Requesting on a new timestamp should be permitted. on the same timestamp should fail.
      const newearlyExpirationTimestamp = earlyExpirationTimestamp + 10;
      await longShortPair.methods.requestEarlyExpiration(newearlyExpirationTimestamp).send({ from: rando });
      assert.equal(await longShortPair.methods.earlyExpirationTimestamp().call(), newearlyExpirationTimestamp);
    });
    it("Can not call expire (normal expiration) if an early expiration is pending or correctly passed", async function () {
      // If the LSP is currently pending early expiration(request has been sent but no price returned yet) the normal
      // expire method should revert.

      await longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp).send({ from: rando });

      // Try call the expire method, which should fail.
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: rando })));

      // If the OO has a pending price for this identifier (proposal made but not settled) it should still revert.
      await optimisticOracle.methods
        .proposePrice(
          longShortPair.options.address,
          priceIdentifier,
          earlyExpirationTimestamp,
          earlyExpirationAncillaryData,
          toWei("5")
        )
        .send({ from: deployer });
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: rando })));

      // Settle the price request in the OO. Expire should still revert.
      await optimisticOracle.methods
        .setCurrentTime(parseInt(await optimisticOracle.methods.getCurrentTime().call()) + optimisticOracleLivenessTime)
        .send({ from: deployer });
      await optimisticOracle.methods
        .settle(longShortPair.options.address, priceIdentifier, earlyExpirationTimestamp, earlyExpirationAncillaryData)
        .send({ from: deployer });
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: rando })));

      // Advance time after the end of the original expiration timestamp. As we have a price from the early expiration
      // settle should still revert.
      await timer.methods.setCurrentTime(expirationTimestamp + 1).send({ from: deployer });
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: rando })));
    });
    it("Can call expire (normal expiration) if an early expiration attempt failed", async function () {
      // If the LSP is attempted to be early expired, which fails (OO returns a price of type(int256).min) then the
      // normal expire call should work as per usual after the end of the liveness period.

      await longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp).send({ from: rando });

      // Propose a to the OO that indicates the contract should not settle.
      await proposeAndSettleOptimisticOraclePrice(
        toBN(MIN_INT_VALUE), // Magic number the LSP uses to ignore early expiration settlement actions.
        earlyExpirationTimestamp,
        earlyExpirationAncillaryData
      );

      // Before expiration expire should revert.
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: rando })));

      // Advance time past expiration. Should now be able to call the expire method.
      await timer.methods.setCurrentTime(expirationTimestamp + 1).send({ from: deployer });
      await longShortPair.methods.expire().send({ from: rando });
    });
    it("Calling early expire incorrectly right before expiration behaves correctly", async function () {
      // Consider trying to incorrectly early expire the LSP right before the normal expiration time. Doing this should
      // block the call to expire until such time that the early expiration has passed liveness and returned a price.
      // As the early expiration was invalid, the standard expire call should work as per usual.
      await timer.methods.setCurrentTime(expirationTimestamp - 10).send({ from: deployer });

      await longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp).send({ from: rando });
      // const ooPriceRequestedEvent1 = await optimisticOracle.getPastEvents("RequestPrice", { fromBock: 0 });

      // Propose a price to the OO to flag this early expiration was invalid.
      await optimisticOracle.methods
        .proposePrice(
          longShortPair.options.address,
          priceIdentifier,
          earlyExpirationTimestamp,
          earlyExpirationAncillaryData,
          toBN(MIN_INT_VALUE)
        )
        .send({ from: deployer });

      // As before expiration timestamp expire should revert.
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: rando })));

      // Advance time to be past the contract expiration but before the OO liveness. This means the contract does not
      // yet have a settlement price. This should block expire calls.
      await optimisticOracle.methods
        .setCurrentTime(
          parseInt(await optimisticOracle.methods.getCurrentTime().call()) + optimisticOracleLivenessTime - 10
        )
        .send({ from: deployer });

      // Check we are indeed past expiration timestamp.
      assert.isTrue(
        Number(await timer.methods.getCurrentTime().call()) >
          Number(await longShortPair.methods.expirationTimestamp().call())
      );

      // As no OO price should not be able to expire.
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: rando })));

      // If we advance time past the OO liveness (another 10 seconds) we should now be able to call expire. Note that
      // we did not need to settle the price request as this happened in the `expire` call calling the
      // `isContractEarlyExpired` which calls the `settleAndGetPrice` method on the OO.
      await optimisticOracle.methods
        .setCurrentTime(parseInt(await optimisticOracle.methods.getCurrentTime().call()) + 10)
        .send({ from: deployer });
      const expireTx = await longShortPair.methods.expire().send({ from: rando });

      // To validate this, we should be able to see the event data emitted from the OO. This should contain normal
      // expiration timestamp, ancillary data on the request (not early expiration).
      await assertEventEmitted(expireTx, optimisticOracle, "RequestPrice", (ev) => {
        return ev.timestamp == expirationTimestamp && ev.ancillaryData == customAncillaryData;
      });

      // Finally, proposing settlement price to OO and settling it should enable settlement.
      await proposeAndSettleOptimisticOraclePrice(toWei("0.75"), expirationTimestamp, customAncillaryData);

      await longShortPair.methods.settle(toWei("100"), toWei("100")).send({ from: sponsor });
      assert.equal(await collateralToken.methods.balanceOf(sponsor).call(), toWei("1000")); // 1000-100+100
      assert.equal(await longShortPair.methods.expiryPrice().call(), toWei("0.75"));
      assert.isTrue(await longShortPair.methods.receivedSettlementPrice().call());
    });
    it("Calling early expire correctly right before expiration behaves correctly", async function () {
      // Consider trying to correctly early expire the LSP right before the normal expiration time. Doing this should
      // block the call to expire in totality and the resultant settlement price should be the early expiration price.
      // As the early expiration was invalid, the standard expire call should work as per usual.
      await timer.methods.setCurrentTime(expirationTimestamp - 10).send({ from: deployer });

      await longShortPair.methods.requestEarlyExpiration(earlyExpirationTimestamp).send({ from: rando });
      // const ooPriceRequestedEvent1 = await optimisticOracle.getPastEvents("RequestPrice", { fromBock: 0 });
      // console.log("ooPriceRequestedEvent1", ooPriceRequestedEvent1);

      // Propose a price to the OO to flag this early expiration was invalid.
      await optimisticOracle.methods
        .proposePrice(
          longShortPair.options.address,
          priceIdentifier,
          earlyExpirationTimestamp,
          earlyExpirationAncillaryData,
          toWei("0.5") // some valid expiration price
        )
        .send({ from: deployer });

      // As before expiration timestamp expire should revert.
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: rando })));

      // Advance time to be past the contract expiration but before the OO liveness. This means the contract does not
      // yet have a settlement price. This should block expire calls.
      await optimisticOracle.methods
        .setCurrentTime(
          parseInt(await optimisticOracle.methods.getCurrentTime().call()) + optimisticOracleLivenessTime - 10
        )
        .send({ from: deployer });

      // Check we are indeed past expiration timestamp.
      assert.isTrue(
        Number(await timer.methods.getCurrentTime().call()) >
          Number(await longShortPair.methods.expirationTimestamp().call())
      );

      // As no OO price should not be able to expire.
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: rando })));

      // If we advance time past the OO liveness (another 10 seconds) we should still not be able to call expire as
      // the provided early expiration price was valid and calling expire is now not ever possible.
      await optimisticOracle.methods
        .setCurrentTime(parseInt(await optimisticOracle.methods.getCurrentTime().call()) + 20)
        .send({ from: deployer });
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: rando })));

      // Settlement should occur at the early expiration price.
      await longShortPair.methods.settle(toWei("100"), toWei("100")).send({ from: sponsor });
      assert.equal(await collateralToken.methods.balanceOf(sponsor).call(), toWei("1000")); // 1000-100+100
      assert.equal(await longShortPair.methods.expiryPrice().call(), toWei("0.5"));
      assert.isTrue(await longShortPair.methods.receivedSettlementPrice().call());
    });
  });
});
