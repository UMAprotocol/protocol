const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const StructuredNoteFinancialProductLibrary = artifacts.require("StructuredNoteFinancialProductLibrary");

// Helper contracts
const Timer = artifacts.require("Timer");
const ExpiringMultiPartyMock = artifacts.require("ExpiringMultiPartyMock");

const { toWei, toBN } = web3.utils;
const strikePrice = toBN(toWei("400"));

contract("StructuredNoteFinancialProductLibrary", function() {
  let structuredNoteFPL;
  let expiringMultiParty;
  let timer;
  let expirationTime;

  beforeEach(async () => {
    timer = await Timer.deployed();

    expirationTime = (await timer.getCurrentTime()) + 100; // use 100 seconds in the future as the expiration time.
    structuredNoteFPL = await StructuredNoteFinancialProductLibrary.new();
    expiringMultiParty = await ExpiringMultiPartyMock.new(structuredNoteFPL.address, expirationTime, timer.address);

    await structuredNoteFPL.setFinancialProductStrike(expiringMultiParty.address, {
      rawValue: strikePrice.toString()
    });
  });
  it("Strike correctly set", async () => {
    assert.equal(
      (await structuredNoteFPL.getStrikeForFinancialProduct(expiringMultiParty.address)).toString(),
      strikePrice.toString()
    );
  });
  it("Can not re-set the strike for a given financial product", async () => {
    assert(
      await didContractThrow(
        structuredNoteFPL.setFinancialProductStrike(expiringMultiParty.address, {
          rawValue: strikePrice.toString()
        })
      )
    );
  });
  it("Can not set strike price for invalid financial product", async () => {
    assert(
      await didContractThrow(
        structuredNoteFPL.setFinancialProductStrike(ZERO_ADDRESS, {
          rawValue: strikePrice.toString()
        })
      )
    );
    assert(
      await didContractThrow(
        structuredNoteFPL.setFinancialProductStrike(timer.address, {
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
