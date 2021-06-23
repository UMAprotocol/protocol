const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { toWei, utf8ToHex, toBN } = web3.utils;
const truffleAssert = require("truffle-assertions");
const { assert } = require("chai");

// Libraries and helpers
const { interfaceName, didContractThrow, MAX_UINT_VAL, ZERO_ADDRESS, ConvertDecimals } = require("@uma/common");

// Tested Contract
const LongShortPair = getContract("LongShortPair");
const LongShortPairFinancialProjectLibraryTest = getContract("LongShortPairFinancialProjectLibraryTest");

// Helper contracts
const AddressWhitelist = getContract("AddressWhitelist");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Finder = getContract("Finder");
const Timer = getContract("Timer");
const OptimisticOracle = getContract("OptimisticOracle");
const Token = getContract("ExpandedERC20");

// Contracts
let collateralToken;
let longToken;
let shortToken;
let longShortPair;
let longShortPairLibrary;
let collateralWhitelist;
let identifierWhitelist;
let optimisticOracle;
let finder;
let ancillaryData = web3.utils.utf8ToHex("some-address-field:0x1234");
let timer;
let constructorParams;

const startTimestamp = Math.floor(Date.now() / 1000);
const expirationTimestamp = startTimestamp + 10000;
const optimisticOracleLiveness = 7200;
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralPerPair = toWei("1"); // each pair of long and short tokens need 1 unit of collateral to mint.
const prepaidProposerReward = toWei("100");

contract("LongShortPair", function (accounts) {
  const deployer = accounts[0];
  const sponsor = accounts[1];
  const holder = accounts[2];

  const proposeAndSettleOptimisticOraclePrice = async (priceFeedIdentifier, requestTime, price) => {
    await optimisticOracle.methods
      .proposePrice(longShortPair.options.address, priceFeedIdentifier, requestTime, ancillaryData, price)
      .send({ from: accounts[0] });
    await optimisticOracle.setCurrentTime(
      (await optimisticOracle.methods.getCurrentTime().call()) + optimisticOracleLiveness
    );
    await optimisticOracle.methods
      .settle(longShortPair.options.address, priceFeedIdentifier, requestTime, ancillaryData)
      .send({ from: accounts[0] });
  };

  beforeEach(async function () {
    await runDefaultFixture(hre);
    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: deployer });

    // Force each test to start with a simulated time that's synced to the startTimestamp.
    await timer.methods.setCurrentTime(startTimestamp).send({ from: accounts[0] });

    collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] }).send({ from: deployer });
    await collateralToken.methods.addMember(1, deployer).send({ from: deployer });
    await collateralToken.mint(sponsor, toWei("1000"), { from: deployer });

    await collateralWhitelist.methods.addToWhitelist(collateralToken.options.address).send({ from: accounts[0] });

    longToken = await Token.new("Long Token", "lTKN", 18).send({ from: accounts[0] }).send({ from: deployer });
    shortToken = await Token.new("Short Token", "sTKN", 18).send({ from: accounts[0] }).send({ from: deployer });

    optimisticOracle = await OptimisticOracle.new(
      optimisticOracleLiveness,
      finder.options.address,
      timer.options.address
    ).send({ from: accounts[0] });
    await finder.methods.changeImplementationAddress(
      utf8ToHex(interfaceName.OptimisticOracle),
      optimisticOracle.options.address,
      { from: deployer }
    );

    // Create LSP library and LSP contract.
    longShortPairLibrary = await LongShortPairFinancialProjectLibraryTest.new().send({ from: accounts[0] });

    constructorParams = {
      expirationTimestamp,
      collateralPerPair,
      priceFeedIdentifier,
      longTokenAddress: longToken.options.address,
      shortTokenAddress: shortToken.options.address,
      collateralTokenAddress: collateralToken.options.address,
      finderAddress: finder.options.address,
      LongShortPairLibraryAddress: longShortPairLibrary.options.address,
      ancillaryData,
      prepaidProposerReward,
      timerAddress: timer.options.address,
    };

    longShortPair = await LongShortPair.new(...Object.values(constructorParams));
    await collateralToken.mint(longShortPair.options.address, toWei("100"));

    // Add mint and burn roles for the long and short tokens to the long short pair.
    await longToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
    await shortToken.methods.addMember(1, longShortPair.options.address).send({ from: deployer });
    await longToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
    await shortToken.methods.addMember(2, longShortPair.options.address).send({ from: deployer });
  });
  describe("Basic Functionality", () => {
    it("Rejects invalid constructor parameters", async function () {
      // Invalid expiration time.
      assert(
        await didContractThrow(
          LongShortPair.new(
            ...Object.values({
              ...constructorParams,
              expirationTimestamp: (await timer.methods.getCurrentTime().call()) - 1,
            })
          )
        )
      );

      // Invalid collateral per pair.
      assert(
        await didContractThrow(LongShortPair.new(...Object.values({ ...constructorParams, collateralPerPair: "0" })))
      );

      // Invalid price identifier time.
      assert(
        await didContractThrow(
          LongShortPair.new(...Object.values({ ...constructorParams, priceFeedIdentifier: "BAD-IDENTIFIER" }))
        )
      );
      // Invalid LSP library address.
      assert(
        await didContractThrow(
          LongShortPair.new(...Object.values({ ...constructorParams, longShortPairLibraryAddress: ZERO_ADDRESS }))
        )
      );

      // Invalid Finder address.
      assert(
        await didContractThrow(
          LongShortPair.new(...Object.values({ ...constructorParams, finderAddress: ZERO_ADDRESS }))
        )
      );

      // Test ancillary data limits.
      // Get max length from contract.
      const maxLength = (await optimisticOracle.methods.ancillaryBytesLimit().call()).toNumber();

      // Remove the OO bytes
      const ooAncillary = await optimisticOracle.stampAncillaryData("0x", web3.utils.randomHex(20));
      const remainingLength = maxLength - (ooAncillary.length - 2) / 2; // Remove the 0x and divide by 2 to get bytes.
      assert(
        await didContractThrow(
          LongShortPair.new(
            ...Object.values({ ...constructorParams, ancillaryData: web3.utils.randomHex(remainingLength + 1) })
          )
        )
      );
    });
    it("Mint, redeem, expire lifecycle", async function () {
      // Create some sponsor tokens. Send half to the holder account.
      assert.equal(await collateralToken.methods.balanceOf(sponsor).call(), toWei("1000"));
      assert.equal(await longToken.methods.balanceOf(sponsor).call(), toWei("0"));
      assert.equal(await shortToken.methods.balanceOf(sponsor).call(), toWei("0"));

      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await longShortPair.create(toWei("100"), { from: sponsor });

      // Collateral should have decreased by tokensMinted/collateral per token. Long & short should have increase by tokensMinted.
      assert.equal((await collateralToken.methods.balanceOf(sponsor).call()).toString(), toWei("900")); // 1000 starting balance - 100 for mint.
      assert.equal(await longToken.methods.balanceOf(sponsor).call(), toWei("100"));
      assert.equal(await shortToken.methods.balanceOf(sponsor).call(), toWei("100"));

      // Send half the long tokens to the holder. This would happen by the holder buying them on a dex.
      await longToken.transfer(holder, toWei("50"), { from: sponsor });

      // Token sponsor redeems half their remaining long tokens, along with the associated short tokens.
      await longShortPair.redeem(toWei("25"), { from: sponsor });

      // Sponsor should have 25 remaining long tokens and 75 remaining short tokens. They should have been refunded 25 collateral.
      assert.equal((await collateralToken.methods.balanceOf(sponsor).call()).toString(), toWei("925")); // 900 after mint + 25 redeemed.
      assert.equal(await longToken.methods.balanceOf(sponsor).call(), toWei("25"));
      assert.equal(await shortToken.methods.balanceOf(sponsor).call(), toWei("75"));

      // holder should not be able to call redeem as they only have the long token and redemption requires a pair.
      assert(await didContractThrow(longShortPair.redeem(toWei("25"), { from: holder })));

      // Advance past the expiry timestamp and settle the contract.
      await timer.setCurrentTime(expirationTimestamp + 1);

      assert.equal(await longShortPair.methods.contractState().call(), 0); // state should be Open before.
      await longShortPair.methods.expire().send({ from: accounts[0] });
      assert.equal(await longShortPair.methods.contractState().call(), 1); // state should be ExpiredPriceRequested before.

      await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, expirationTimestamp, toWei("0.5"));

      // Redemption value scaled between 0 and 1, indicating how much of the collateralPerPair is split between the long and
      // short tokens. Setting to 0.5 makes each long token worth 0.5 collateral and each short token worth 0.5 collateral.
      await longShortPairLibrary.setValueToReturn(toWei("0.5"));

      await longShortPair.settle(toWei("50"), toWei("0"), { from: holder }); // holder redeem their 50 long tokens.
      assert.equal(await longToken.methods.balanceOf(holder).call(), toWei("0")); // they should have no long tokens left.
      assert.equal((await collateralToken.methods.balanceOf(holder).call()).toString(), toWei("25")); // they should have gotten 0.5 collateral per synthetic.

      // Sponsor redeem remaining tokens. They return the remaining 25 long and 75 short. Each should be redeemable for 0.5 collateral.
      await longShortPair.settle(toWei("25"), toWei("75"), { from: sponsor });

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

      const expireTx = await longShortPair.methods.expire().call();

      truffleAssert.eventEmitted(expireTx, "ContractExpired", (ev) => {
        return ev.caller == deployer;
      });

      await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, expirationTimestamp, toWei("0.5"));

      await longShortPairLibrary.setValueToReturn(toWei("0.5"));

      const settleTx = await longShortPair.settle(toWei("75"), toWei("75"), { from: sponsor });

      truffleAssert.eventEmitted(settleTx, "PositionSettled", (ev) => {
        return (
          ev.sponsor == sponsor &&
          ev.colllateralReturned == toWei("75") &&
          ev.longTokens == toWei("75") &&
          ev.shortTokens == toWei("75")
        );
      });
    });
    it("Ancillary data is correctly set in the OO", async function () {
      await timer.setCurrentTime(expirationTimestamp + 1);
      await longShortPair.methods.expire().send({ from: accounts[0] });
      const request = await optimisticOracle.methods
        .getRequest(longShortPair.options.address, priceFeedIdentifier, expirationTimestamp, ancillaryData)
        .call();

      assert.equal(request.currency, collateralToken.options.address);
    });
  });
  describe("Settlement Functionality", () => {
    // Create a position, advance time, expire contract and propose price. Manually set different expiryPercentLong values
    // using the test longShortPairLibrary that bypass the OO return value so we dont need to test the lib here.
    let sponsorCollateralBefore;
    beforeEach(async () => {
      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await longShortPair.create(toWei("100"), { from: sponsor });
      await timer.setCurrentTime(expirationTimestamp + 1);
      await longShortPair.methods.expire().send({ from: accounts[0] });
      await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, expirationTimestamp, toWei("0.5"));
      sponsorCollateralBefore = await collateralToken.methods.balanceOf(sponsor).call();
    });
    it("expiryPercentLong = 1 should give all collateral to long tokens", async function () {
      await longShortPairLibrary.methods.setValueToReturn(toWei("1")).send({ from: accounts[0] });

      // Redeeming only short tokens should send 0 collateral as the short tokens are worthless.
      await longShortPair.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.toString()
      );

      // Redeeming the long tokens should send the full amount of collateral to the sponsor.
      await longShortPair.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiryPercentLong = 0 should give all collateral to short tokens", async function () {
      await longShortPairLibrary.methods.setValueToReturn(toWei("0")).send({ from: accounts[0] });
      // Redeeming only long tokens should send 0 collateral as the long tokens are worthless.
      await longShortPair.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.toString()
      );

      // Redeeming the short tokens should send the full amount of collateral to the sponsor.
      await longShortPair.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiryTokensForCollateral > 1 should ceil to 1", async function () {
      // anything above 1 for the expiryPercentLong is nonsensical and the LSP should act as if it's set to 1.
      await longShortPairLibrary.setValueToReturn(toWei("1.5"));

      // Redeeming long short tokens should send no collateral.
      await longShortPair.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.toString()
      );

      // Redeeming long tokens should send all the collateral.
      await longShortPair.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiryPercentLong = 0.25 should give 25% to long and 75% to short", async function () {
      await longShortPairLibrary.setValueToReturn(toWei("0.25"));

      // Redeeming long tokens should send 25% of the collateral.
      await longShortPair.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralBefore.add(toBN(toWei("25"))).toString()
      );
      const sponsorCollateralAfterLongRedeem = await collateralToken.methods.balanceOf(sponsor).call();

      // Redeeming short tokens should send the remaining 75% of the collateral.
      await longShortPair.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        sponsorCollateralAfterLongRedeem.add(toBN(toWei("75"))).toString()
      );
    });
    it("Cannot settle more tokens than in wallet", async function () {
      // Sponsor only has 100 long and 100 short. anything more than this should revert.
      assert(await didContractThrow(longShortPair.settle(toWei("110"), toWei("100"), { from: sponsor })));
    });
    it("prepaidProposerReward was correctly set/transferred in the OptimisticOracle", async function () {
      // Deployer should have received a proposal reward.
      assert.equal((await collateralToken.methods.balanceOf(deployer).call()).toString(), prepaidProposerReward);
      // Request should have the reward encoded.
      assert.equal(
        (
          await optimisticOracle.methods
            .getRequest(longShortPair.options.address, priceFeedIdentifier, expirationTimestamp, ancillaryData)
            .send({ from: accounts[0] })
        ).reward.toString(),
        toWei("100")
      );
    });
  });
  describe("Contract States", () => {
    beforeEach(async () => {
      await collateralToken.methods.approve(longShortPair.options.address, MAX_UINT_VAL).send({ from: sponsor });
      await longShortPair.create(toWei("100"), { from: sponsor });
    });
    it("Can not expire pre expirationTimestamp", async function () {
      assert(await didContractThrow(longShortPair.methods.expire().send({ from: accounts[0] })));
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
      await longShortPair.methods.expire().send({ from: accounts[0] });
      await optimisticOracle.proposePrice(
        longShortPair.options.address,
        priceFeedIdentifier,
        expirationTimestamp,
        ancillaryData,
        toWei("0.5")
      );
      assert(await didContractThrow(longShortPair.settle(toWei("100"), toWei("100"), { from: sponsor })));
    });
  });
  describe("Non-standard ERC20 Decimals", () => {
    const convertDecimals = ConvertDecimals(0, 6, this.web3);
    beforeEach(async () => {
      console.log("convertDecimals", convertDecimals(6).toString());

      collateralToken = await Token.new("USD Coin", "USDC", 6).send({ from: accounts[0] }).send({ from: deployer });
      await collateralToken.methods.addMember(1, deployer).send({ from: deployer });
      await collateralToken.mint(sponsor, convertDecimals("1000"), { from: deployer });

      await collateralWhitelist.methods.addToWhitelist(collateralToken.options.address).send({ from: accounts[0] });

      longToken = await Token.new("Long Token", "lTKN", 6).send({ from: accounts[0] }).send({ from: deployer });
      shortToken = await Token.new("Short Token", "sTKN", 6).send({ from: accounts[0] }).send({ from: deployer });

      constructorParams = {
        ...constructorParams,
        longTokenAddress: longToken.options.address,
        shortTokenAddress: shortToken.options.address,
        collateralTokenAddress: collateralToken.options.address,
        prepaidProposerReward: convertDecimals("100"),
      };

      longShortPair = await LongShortPair.new(...Object.values(constructorParams));
      await collateralToken.mint(longShortPair.options.address, convertDecimals("100"));

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
      await longShortPair.create(convertDecimals("100"), { from: sponsor });

      // Collateral should have decreased by tokensMinted/collateral per token. Long & short should have increase by tokensMinted.
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        convertDecimals("900").toString()
      ); // 1000 starting balance - 100 for mint.
      assert.equal((await longToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("100").toString());
      assert.equal((await shortToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("100").toString());

      // Send half the long tokens to the holder. This would happen by the holder buying them on a dex.
      await longToken.transfer(holder, convertDecimals("50"), { from: sponsor });

      // Token sponsor redeems half their remaining long tokens, along with the associated short tokens.
      await longShortPair.redeem(convertDecimals("25"), { from: sponsor });

      // Sponsor should have 25 remaining long tokens and 75 remaining short tokens. They should have been refunded 25 collateral.
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        convertDecimals("925").toString()
      ); // 900 after mint + 25 redeemed.
      assert.equal((await longToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("25").toString());
      assert.equal((await shortToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("75").toString());

      // holder should not be able to call redeem as they only have the long token and redemption requires a pair.
      assert(await didContractThrow(longShortPair.redeem(convertDecimals("25"), { from: holder })));

      // Advance past the expiry timestamp and settle the contract.
      await timer.setCurrentTime(expirationTimestamp + 1);

      assert.equal(await longShortPair.methods.contractState().call(), 0); // state should be Open before.
      await longShortPair.methods.expire().send({ from: accounts[0] });
      assert.equal(await longShortPair.methods.contractState().call(), 1); // state should be ExpiredPriceRequested before.

      // Note that this proposal is scaled by 1e18. Prices returned from the DVM are scaled independently of the contract decimals.
      await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, expirationTimestamp, toWei("0.5"));

      // Redemption value scaled between 0 and 1, indicating how much of the collateralPerPair is split between the long and
      // short tokens. Setting to 0.5 makes each long token worth 0.5 collateral and each short token worth 0.5 collateral.
      // Note that this value is still scaled by 1e18 as this lib is independent of decimals.
      await longShortPairLibrary.setValueToReturn(toWei("0.5"));

      await longShortPair.settle(convertDecimals("50"), convertDecimals("0"), { from: holder }); // holder redeem their 50 long tokens.
      assert.equal((await longToken.methods.balanceOf(holder).call()).toString(), convertDecimals("0")); // they should have no long tokens left.
      assert.equal((await collateralToken.methods.balanceOf(holder).call()).toString(), convertDecimals("25")); // they should have gotten 0.5 collateral per synthetic.

      // Sponsor redeem remaining tokens. They return the remaining 25 long and 75 short. Each should be redeemable for 0.5 collateral.
      await longShortPair.settle(convertDecimals("25"), convertDecimals("75"), { from: sponsor });

      assert.equal((await longToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("0").toString());
      assert.equal((await longToken.methods.balanceOf(sponsor).call()).toString(), convertDecimals("0").toString());
      assert.equal(
        (await collateralToken.methods.balanceOf(sponsor).call()).toString(),
        convertDecimals("975").toString()
      ); // 925 after redemption + 12.5 redeemed for long and 37.5 for short.

      // long short pair should have no collateral left in it as everything has been redeemed.
      assert.equal(
        (await collateralToken.methods.balanceOf(longShortPair.options.address).call()).toString(),
        convertDecimals("0")
      );
    });
  });
});
