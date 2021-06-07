const { toWei, utf8ToHex, toBN } = web3.utils;
const truffleAssert = require("truffle-assertions");
const { assert } = require("chai");

// Libraries and helpers
const { interfaceName, didContractThrow, MAX_UINT_VAL, ZERO_ADDRESS } = require("@uma/common");

// Tested Contract
const ContractForDifference = artifacts.require("ContractForDifference");
const ContractForDifferenceFinancialProjectLibraryTest = artifacts.require(
  "ContractForDifferenceFinancialProjectLibraryTest"
);

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
let contractForDifference;
let contractForDifferenceLibrary;
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

const proposeAndSettleOptimisticOraclePrice = async (priceFeedIdentifier, requestTime, price) => {
  await optimisticOracle.proposePrice(
    contractForDifference.address,
    priceFeedIdentifier,
    requestTime,
    ancillaryData,
    price
  );
  await optimisticOracle.setCurrentTime((await optimisticOracle.getCurrentTime()) + optimisticOracleLiveness);
  await optimisticOracle.settle(contractForDifference.address, priceFeedIdentifier, requestTime, ancillaryData);
};

contract("ContractForDifference", function (accounts) {
  const deployer = accounts[0];
  const sponsor = accounts[1];
  const holder = accounts[2];

  before(async () => {
    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier, { from: deployer });
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

    optimisticOracle = await OptimisticOracle.new(optimisticOracleLiveness, finder.address, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.address, {
      from: deployer,
    });

    // Create CFD library and CFD contract.
    contractForDifferenceLibrary = await ContractForDifferenceFinancialProjectLibraryTest.new();

    constructorParams = {
      expirationTimestamp,
      collateralPerPair,
      priceFeedIdentifier,
      longTokenAddress: longToken.address,
      shortTokenAddress: shortToken.address,
      collateralTokenAddress: collateralToken.address,
      finderAddress: finder.address,
      contractForDifferenceLibraryAddress: contractForDifferenceLibrary.address,
      ancillaryData,
      timerAddress: timer.address,
    };

    contractForDifference = await ContractForDifference.new(...Object.values(constructorParams));

    // Add mint and burn roles for the long and short tokens to the contract for difference.
    await longToken.addMember(1, contractForDifference.address, { from: deployer });
    await shortToken.addMember(1, contractForDifference.address, { from: deployer });
    await longToken.addMember(2, contractForDifference.address, { from: deployer });
    await shortToken.addMember(2, contractForDifference.address, { from: deployer });
  });
  describe("Basic Functionality", () => {
    it("Rejects invalid constructor paramaters", async function () {
      // Invalid expiration time.
      assert(
        await didContractThrow(
          ContractForDifference.new(
            ...Object.values({ ...constructorParams, expirationTimestamp: (await timer.getCurrentTime()) - 1 })
          )
        )
      );

      // Invalid price identifier time.
      assert(
        await didContractThrow(
          ContractForDifference.new(...Object.values({ ...constructorParams, priceFeedIdentifier: "BAD-IDENTIFIER" }))
        )
      );
      // Invalid CFD library address.
      assert(
        await didContractThrow(
          ContractForDifference.new(
            ...Object.values({ ...constructorParams, contractForDifferenceLibraryAddress: ZERO_ADDRESS })
          )
        )
      );

      // Invalid Finder address.
      assert(
        await didContractThrow(
          ContractForDifference.new(...Object.values({ ...constructorParams, finderAddress: ZERO_ADDRESS }))
        )
      );

      // Test ancillary data limits.
      // Get max lenngth from contract.
      const maxLength = (await optimisticOracle.ancillaryBytesLimit()).toNumber();

      // Remmove the OO bytes
      const ooAncillary = await optimisticOracle.stampAncillaryData("0x", web3.utils.randomHex(20));
      const remainingLength = maxLength - (ooAncillary.length - 2) / 2; // Remove the 0x and divide by 2 to get bytes.
      assert(
        await didContractThrow(
          ContractForDifference.new(
            ...Object.values({ ...constructorParams, ancillaryData: web3.utils.randomHex(remainingLength + 1) })
          )
        )
      );
    });
    it("Mint, redeem, expire lifecycle", async function () {
      // Create some sponsor tokens. Send half to the holder account.
      assert.equal(await collateralToken.balanceOf(sponsor), toWei("1000"));
      assert.equal(await longToken.balanceOf(sponsor), toWei("0"));
      assert.equal(await shortToken.balanceOf(sponsor), toWei("0"));

      await collateralToken.approve(contractForDifference.address, MAX_UINT_VAL, { from: sponsor });
      await contractForDifference.create(toWei("100"), { from: sponsor });

      // Collateral should have decreased by tokensMinted/collateral per token. Long & short should have increase by tokensMinted.
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), toWei("900")); // 1000 starting balance - 100 for mint.
      assert.equal(await longToken.balanceOf(sponsor), toWei("100"));
      assert.equal(await shortToken.balanceOf(sponsor), toWei("100"));

      // Send half the long tokens to the holder. This would happen by the holder buying them on a dex.
      await longToken.transfer(holder, toWei("50"), { from: sponsor });

      // Token sponsor redeems half their remaining long tokens, along with the associated short tokens.
      await contractForDifference.redeem(toWei("25"), { from: sponsor });

      // Sponsor should have 25 remaining long tokens and 75 remaining short tokens. They should have been refunded 25 collateral.
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), toWei("925")); // 900 after mint + 25 redeemed.
      assert.equal(await longToken.balanceOf(sponsor), toWei("25"));
      assert.equal(await shortToken.balanceOf(sponsor), toWei("75"));

      // holder should not be able to call redeem as they only have the long token and redemption requires a pair.
      assert(await didContractThrow(contractForDifference.redeem(toWei("25"), { from: holder })));

      // Advance past the expiry timestamp and settle the contract.
      await timer.setCurrentTime(expirationTimestamp + 1);

      assert.equal(await contractForDifference.contractState(), 0); // state should be Open before.
      await contractForDifference.expire();
      assert.equal(await contractForDifference.contractState(), 1); // state should be ExpiredPriceRequested before.

      await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, expirationTimestamp, toWei("0.5"));

      // Redemption value scaled between 0 and 1, indicating how much of the collateralPerPair is split between the long and
      // short tokens. Setting to 0.5 makes each long token worth 0.5 collateral and each short token worth 0.5 collateral.

      await contractForDifferenceLibrary.setValueToReturn(toWei("0.5"));

      await contractForDifference.settle(toWei("50"), toWei("0"), { from: holder }); // holder redeem their 50 long tokens.
      assert.equal(await longToken.balanceOf(holder), toWei("0")); // they should have no long tokens left.
      assert.equal((await collateralToken.balanceOf(holder)).toString(), toWei("25")); // they should have gotten 0.5 collateral per synthetic.

      // Sponsor redeem remaining tokens. They return the remaining 25 long and 75 short. Each should be redeemable for 0.5 collateral.
      await contractForDifference.settle(toWei("25"), toWei("75"), { from: sponsor });

      assert.equal(await longToken.balanceOf(sponsor), toWei("0"));
      assert.equal(await longToken.balanceOf(sponsor), toWei("0"));
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), toWei("975")); // 925 after redemption + 12.5 redeemed for long and 37.5 for short.

      // Contract for difference should have no collateral left in it as everything has been redeemed.
      assert.equal((await collateralToken.balanceOf(contractForDifference.address)).toString(), toWei("0"));
    });
    it("Events are correctly emitted", async function () {
      await collateralToken.approve(contractForDifference.address, MAX_UINT_VAL, { from: sponsor });
      const createTx = await contractForDifference.create(toWei("100"), { from: sponsor });

      truffleAssert.eventEmitted(createTx, "TokensCreated", (ev) => {
        return ev.sponsor == sponsor && ev.collateralUsed == toWei("100") && ev.tokensMinted == toWei("100");
      });

      const redeemTx = await contractForDifference.redeem(toWei("25"), { from: sponsor });

      truffleAssert.eventEmitted(redeemTx, "TokensRedeemed", (ev) => {
        return ev.sponsor == sponsor && ev.collateralReturned == toWei("25") && ev.tokensRedeemed == toWei("25");
      });

      // Advance past the expiry timestamp and settle the contract.
      await timer.setCurrentTime(expirationTimestamp + 1);

      const expireTx = await contractForDifference.expire();

      truffleAssert.eventEmitted(expireTx, "ContractExpired", (ev) => {
        return ev.caller == deployer;
      });

      await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, expirationTimestamp, toWei("0.5"));

      await contractForDifferenceLibrary.setValueToReturn(toWei("0.5"));

      const settleTx = await contractForDifference.settle(toWei("75"), toWei("75"), { from: sponsor });

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
      await contractForDifference.expire();
      const request = await optimisticOracle.getRequest(
        contractForDifference.address,
        priceFeedIdentifier,
        expirationTimestamp,
        ancillaryData
      );

      assert.equal(request.currency, collateralToken.address);
    });
  });
  describe("Settlement Functionality", () => {
    // Create a position, advance time, expire contract and propose price. Manually set diffrent expiryPercentLong values
    // using the test contractForDifferenceLibrary that bipasses the OO return value so we dont need to test the lib here.
    let sponsorCollateralBefore;
    beforeEach(async () => {
      await collateralToken.approve(contractForDifference.address, MAX_UINT_VAL, { from: sponsor });
      await contractForDifference.create(toWei("100"), { from: sponsor });
      await timer.setCurrentTime(expirationTimestamp + 1);
      await contractForDifference.expire();
      await proposeAndSettleOptimisticOraclePrice(priceFeedIdentifier, expirationTimestamp, toWei("0.5"));
      sponsorCollateralBefore = await collateralToken.balanceOf(sponsor);
    });
    it("expiryPercentLong = 1 should give all collateral to long tokens", async function () {
      await contractForDifferenceLibrary.setValueToReturn(toWei("1"));

      // Redeeming only short tokens should send 0 collateral as the short tokens are worthless.
      await contractForDifference.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), sponsorCollateralBefore.toString());

      // Redeeming the long tokens should send the full amount of collateral to the sponsor.
      await contractForDifference.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal(
        (await collateralToken.balanceOf(sponsor)).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiryPercentLong = 0 should give all collateral to short tokens", async function () {
      await contractForDifferenceLibrary.setValueToReturn(toWei("0"));
      // Redeeming only long tokens should send 0 collateral as the long tokens are worthless.
      await contractForDifference.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), sponsorCollateralBefore.toString());

      // Redeeming the short tokens should send the full amount of collateral to the sponsor.
      await contractForDifference.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal(
        (await collateralToken.balanceOf(sponsor)).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiraryTokensForCollateral > 1 should ceil to 1", async function () {
      // anything above 1 for the expiryPercentLong is nonsencial and the CFD should act as if it's set to 1.
      await contractForDifferenceLibrary.setValueToReturn(toWei("1.5"));

      // Redeeming long short tokens should send no collateral.
      await contractForDifference.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal((await collateralToken.balanceOf(sponsor)).toString(), sponsorCollateralBefore.toString());

      // Redeeming long tokens should send all the collateral.
      await contractForDifference.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal(
        (await collateralToken.balanceOf(sponsor)).toString(),
        sponsorCollateralBefore.add(toBN(toWei("100"))).toString()
      );
    });
    it("expiryPercentLong = 0.25 should give 25% to long and 75% to short", async function () {
      await contractForDifferenceLibrary.setValueToReturn(toWei("0.25"));

      // Redeeming long tokens should send 25% of the collateral.
      await contractForDifference.settle(toWei("100"), toWei("0"), { from: sponsor });
      assert.equal(
        (await collateralToken.balanceOf(sponsor)).toString(),
        sponsorCollateralBefore.add(toBN(toWei("25"))).toString()
      );
      const sponsorCollateralAfterLongRedeem = await collateralToken.balanceOf(sponsor);

      // Redeeming short tokens should send the remaining 75% of the collateral.
      await contractForDifference.settle(toWei("0"), toWei("100"), { from: sponsor });
      assert.equal(
        (await collateralToken.balanceOf(sponsor)).toString(),
        sponsorCollateralAfterLongRedeem.add(toBN(toWei("75"))).toString()
      );
    });
    it("Cannot settle more tokens than in wallet", async function () {
      // Sponsor only has 100 long and 100 short. anything more than this should revert.
      assert(await didContractThrow(contractForDifference.settle(toWei("110"), toWei("100"), { from: sponsor })));
    });
  });
  describe("Contract States", () => {
    beforeEach(async () => {
      await collateralToken.approve(contractForDifference.address, MAX_UINT_VAL, { from: sponsor });
      await contractForDifference.create(toWei("100"), { from: sponsor });
    });
    it("Can not expire pre exiprationTimestamp", async function () {
      assert(await didContractThrow(contractForDifference.expire()));
      assert(await didContractThrow(contractForDifference.settle(toWei("100"), toWei("100"), { from: sponsor })));
    });
    it("Can not create or redeem post expirary", async function () {
      await timer.setCurrentTime(expirationTimestamp + 1);
      assert(await didContractThrow(contractForDifference.create(toWei("100"))), { from: sponsor });
      assert(await didContractThrow(contractForDifference.redeem(toWei("100"))), { from: sponsor });
    });
    it("Can not settle before price returned from OO", async function () {
      // Set time after expiration, add a price to OO but dont pass OO liveness.
      await timer.setCurrentTime(expirationTimestamp + 1);
      await contractForDifference.expire();
      await optimisticOracle.proposePrice(
        contractForDifference.address,
        priceFeedIdentifier,
        expirationTimestamp,
        ancillaryData,
        toWei("0.5")
      );
      assert(await didContractThrow(contractForDifference.settle(toWei("100"), toWei("100"), { from: sponsor })));
    });
  });
});
