const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const StructuredNoteFinancialProductLibrary = artifacts.require("StructuredNoteFinancialProductLibrary");

// Helper contracts
const Timer = artifacts.require("Timer");
const ExpiringMultiPartyMock = artifacts.require("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const strikePrice = toBN(toWei("400"));
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralizationRatio = toWei("1.2");

contract("StructuredNoteFinancialProductLibrary", function () {
  let structuredNoteFPL;
  let expiringMultiParty;
  let timer;
  let expirationTime;

  beforeEach(async () => {
    timer = await Timer.deployed();

    expirationTime = (await timer.getCurrentTime()) + 100; // use 100 seconds in the future as the expiration time.
    structuredNoteFPL = await StructuredNoteFinancialProductLibrary.new();
    expiringMultiParty = await ExpiringMultiPartyMock.new(
      structuredNoteFPL.address,
      expirationTime,
      { rawValue: collateralizationRatio.toString() },
      priceFeedIdentifier,
      timer.address
    );

    await structuredNoteFPL.setFinancialProductStrike(expiringMultiParty.address, {
      rawValue: strikePrice.toString(),
    });
  });
  it("Strike correctly set", async () => {
    assert.equal(
      (await structuredNoteFPL.getStrikeForFinancialProduct(expiringMultiParty.address)).toString(),
      strikePrice.toString()
    );
  });
  describe("price transformation", () => {
    it("Can not re-set the strike for a given financial product", async () => {
      assert(
        await didContractThrow(
          structuredNoteFPL.setFinancialProductStrike(expiringMultiParty.address, {
            rawValue: strikePrice.toString(),
          })
        )
      );
    });
    it("Can not set strike price for invalid financial product", async () => {
      assert(
        await didContractThrow(
          structuredNoteFPL.setFinancialProductStrike(ZERO_ADDRESS, {
            rawValue: strikePrice.toString(),
          })
        )
      );
      assert(
        await didContractThrow(
          structuredNoteFPL.setFinancialProductStrike(timer.address, {
            rawValue: strikePrice.toString(),
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

      // If the oracle price is less than the strike price then the library should return 1.
      assert.equal(
        (
          await expiringMultiParty.transformPrice(
            { rawValue: toWei("350") },
            (await expiringMultiParty.getCurrentTime()).toString()
          )
        ).toString(),
        toWei("1")
      );

      // Else, if the oracle price is more than strike then the library should return the strike/oracle price. For a oracle
      // price of 500 each token is redeemable for 400/500 = 0.8 WETH.
      assert.equal(
        (
          await expiringMultiParty.transformPrice(
            { rawValue: toWei("500") },
            (await expiringMultiParty.getCurrentTime()).toString()
          )
        ).toString(),
        toWei("0.8")
      );
    });
  });
  describe("Collateralization ratio transformation", () => {
    it("Library returns correctly transformed collateralization ratio", async () => {
      // Create a fictitious CR for the financial product. Based on the oracle price this required CR should be scalled accordingly.
      await timer.setCurrentTime(expirationTime + 1);

      // If the oracle price is less than the strike price then the library should return the original CR.
      assert.equal(
        (await expiringMultiParty.transformCollateralRequirement({ rawValue: toWei("350") })).toString(),
        collateralizationRatio
      );

      // Else, if the oracle price is more than strike then the library should return the collateralization ratio scaled
      // by strike/oracle price. For a oracle price of 500  and a CR of 1.2 the library should return 400 / 500 * 1.2 = 0.96
      assert.equal(
        (await expiringMultiParty.transformCollateralRequirement({ rawValue: toWei("500") })).toString(),
        toWei("0.96")
      );
      // For a oracle price of 1000  and a CR of 1.2 the library should return 400 / 1000 * 1.2 = 0.48
      assert.equal(
        (await expiringMultiParty.transformCollateralRequirement({ rawValue: toWei("1000") })).toString(),
        toWei("0.48")
      );
    });
  });
});
