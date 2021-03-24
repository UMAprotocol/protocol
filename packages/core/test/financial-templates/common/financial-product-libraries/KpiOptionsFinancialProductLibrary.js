const { assert } = require("chai");

// Tested Contract
const KpiOptionsFinancialProductLibrary = artifacts.require("KpiOptionsFinancialProductLibrary");

// Helper contracts
const Timer = artifacts.require("Timer");
const ExpiringMultiPartyMock = artifacts.require("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralizationRatio = toBN(toWei("1")).addn(1);

contract("KpiOptionsFinancialProductLibrary", function() {
  let kpiFPL;
  let expiringMultiParty;
  let timer;
  let expirationTime;

  beforeEach(async () => {
    timer = await Timer.deployed();

    expirationTime = (await timer.getCurrentTime()) + 100; // use 100 seconds in the future as the expiration time.
    kpiFPL = await KpiOptionsFinancialProductLibrary.new();
    expiringMultiParty = await ExpiringMultiPartyMock.new(
      kpiFPL.address,
      expirationTime,
      { rawValue: collateralizationRatio.toString() },
      priceFeedIdentifier,
      timer.address
    );
  });
  describe("price transformation", () => {
    it("Library returns 2 price if before expiration", async () => {
      // Calling the transformation function through the emp mock.
      assert.equal(
        (
          await expiringMultiParty.transformPrice(
            { rawValue: toWei("1") },
            (await expiringMultiParty.getCurrentTime()).toString()
          )
        ).toString(),
        toWei("2")
      );

      // Calling the transformation function as a mocked emp caller should also work.
      assert.equal(
        (
          await expiringMultiParty.transformPrice.call(
            { rawValue: toWei("1") },
            (await expiringMultiParty.getCurrentTime()).toString(),
            { from: expiringMultiParty.address }
          )
        ).toString(),
        toWei("2")
      );
    });

    it("Library returns correctly transformed price after expiration", async () => {
      await timer.setCurrentTime(expirationTime + 1);

      // If transformPrice is called after expiration, no transformation should occur.
      assert.equal(
        (
          await expiringMultiParty.transformPrice(
            { rawValue: toWei("0.2") },
            (await expiringMultiParty.getCurrentTime()).toString()
          )
        ).toString(),
        toWei("0.2")
      );
    });
  });

  describe("Collateralization ratio transformation", () => {
    it("Library returns correctly transformed collateralization ratio", async () => {
      // Under all scenarios, the collateral requirement of the contract should be 1.

      // Check pre-expiration
      assert.equal(
        (await expiringMultiParty.transformCollateralRequirement({ rawValue: toWei("0.1") })).toString(),
        toWei("1")
      );

      // advance the timer after expiration and ensure the CR is still 1.
      await timer.setCurrentTime(expirationTime + 1);

      // Check post-expiration
      assert.equal(
        (await expiringMultiParty.transformCollateralRequirement({ rawValue: toWei("0.2") })).toString(),
        toWei("1")
      );
    });
  });
});
