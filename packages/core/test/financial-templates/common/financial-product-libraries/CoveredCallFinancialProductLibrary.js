const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const CoveredCallFinancialProductLibrary = artifacts.require("CoveredCallFinancialProductLibrary");

// Helper contracts
const Timer = artifacts.require("Timer");
const ExpiringMultiPartyMock = artifacts.require("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const strikePrice = toBN(toWei("400"));
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralizationRatio = toBN(toWei("1")).addn(1);

contract("CoveredCallFinancialProductLibrary", function() {
  let coveredCallFPL;
  let expiringMultiParty;
  let timer;
  let expirationTime;

  beforeEach(async () => {
    timer = await Timer.deployed();

    expirationTime = (await timer.getCurrentTime()) + 100; // use 100 seconds in the future as the expiration time.
    coveredCallFPL = await CoveredCallFinancialProductLibrary.new();
    expiringMultiParty = await ExpiringMultiPartyMock.new(
      coveredCallFPL.address,
      expirationTime,
      { rawValue: collateralizationRatio.toString() },
      priceFeedIdentifier,
      timer.address
    );

    await coveredCallFPL.setFinancialProductStrike(expiringMultiParty.address, {
      rawValue: strikePrice.toString()
    });
  });
  it("Strike correctly set", async () => {
    assert.equal(
      (await coveredCallFPL.getStrikeForFinancialProduct(expiringMultiParty.address)).toString(),
      strikePrice.toString()
    );
  });
  describe("price transformation", () => {
    it("Can not re-set the strike for a given financial product", async () => {
      assert(
        await didContractThrow(
          coveredCallFPL.setFinancialProductStrike(expiringMultiParty.address, {
            rawValue: strikePrice.toString()
          })
        )
      );
    });
    it("Can not set strike price for invalid financial product", async () => {
      assert(
        await didContractThrow(
          coveredCallFPL.setFinancialProductStrike(ZERO_ADDRESS, {
            rawValue: strikePrice.toString()
          })
        )
      );
      assert(
        await didContractThrow(
          coveredCallFPL.setFinancialProductStrike(timer.address, {
            rawValue: strikePrice.toString()
          })
        )
      );
    });
    it("Library returns 1 price if before expiration", async () => {
      // Calling the transformation function through the emp mock.
      assert.equal(
        (
          await expiringMultiParty.transformPrice(
            { rawValue: toWei("350") },
            (await expiringMultiParty.getCurrentTime()).toString()
          )
        ).toString(),
        toWei("1")
      );

      // Calling the transformation function as a mocked emp caller should also work.
      assert.equal(
        (
          await expiringMultiParty.transformPrice.call(
            { rawValue: toWei("350") },
            (await expiringMultiParty.getCurrentTime()).toString(),
            { from: expiringMultiParty.address }
          )
        ).toString(),
        toWei("1")
      );
    });

    it("Library returns correctly transformed price after expiration", async () => {
      await timer.setCurrentTime(expirationTime + 1);

      // If the oracle price is less than the strike price then the library should return 0 (the option is out the money).
      assert.equal(
        (
          await expiringMultiParty.transformPrice(
            { rawValue: toWei("350") },
            (await expiringMultiParty.getCurrentTime()).toString()
          )
        ).toString(),
        "0"
      );

      // Else, if the oracle price is more than strike then the library should return the (oraclePrice - strikePrice) / oraclePrice.// Token expires to be worth the fraction of an collateral token that's in the money. eg if ETHUSD is $500 and
      // strike is $400, token is redeemable for 100 / 500 = 0.2 WETH (worth $100).
      assert.equal(
        (
          await expiringMultiParty.transformPrice(
            { rawValue: toWei("500") },
            (await expiringMultiParty.getCurrentTime()).toString()
          )
        ).toString(),
        toWei("0.2")
      );
    });
  });
  describe("Collateralization ratio transformation", () => {
    it("Library returns correctly transformed collateralization ratio", async () => {
      // Under all scenarios, the collateral requirement of the contract should be 1 as this is a fully covered call.

      // Check pre-expiration below strike
      assert.equal(
        (await expiringMultiParty.transformCollateralRequirement({ rawValue: toWei("350") })).toString(),
        toWei("1")
      );
      // Check pre-expiration above strike
      assert.equal(
        (await expiringMultiParty.transformCollateralRequirement({ rawValue: toWei("450") })).toString(),
        toWei("1")
      );

      // advance the timer after expiration and ensure the CR is still 1.
      await timer.setCurrentTime(expirationTime + 1);

      // Check post-expiration below strike
      assert.equal(
        (await expiringMultiParty.transformCollateralRequirement({ rawValue: toWei("350") })).toString(),
        toWei("1")
      );
      // Check post-expiration above strike
      assert.equal(
        (await expiringMultiParty.transformCollateralRequirement({ rawValue: toWei("450") })).toString(),
        toWei("1")
      );
    });
  });
});
