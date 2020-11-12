const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const StructuredNoteFinancialProductLibrary = artifacts.require("StructuredNoteFinancialProductLibrary");

// Helper contracts
const Timer = artifacts.require("Timer");
const ExpiringMultiPartyMock = artifacts.require("ExpiringMultiPartyMock");

const { toWei, toBN } = web3.utils;
const strikePrice = toBN(toWei("400"));

contract("StructuredNoteFinancialProductLibrary", function() {
  let structuredNoteFinancialProductLibrary;
  let mockExpiringMultiParty;
  let timer;
  let expirationTime;

  beforeEach(async () => {
    timer = await Timer.deployed();

    expirationTime = (await timer.getCurrentTime()) + 100; // use 100 seconds in the future as the expiration time.
    structuredNoteFinancialProductLibrary = await StructuredNoteFinancialProductLibrary.new(timer.address);
    mockExpiringMultiParty = await ExpiringMultiPartyMock.new(
      structuredNoteFinancialProductLibrary.address,
      expirationTime
    );

    await structuredNoteFinancialProductLibrary.setFinancialProductStrike(mockExpiringMultiParty.address, {
      rawValue: strikePrice.toString()
    });
  });

  it("Can not re-set the strike for a given financial product", async () => {
    assert(
      await didContractThrow(
        structuredNoteFinancialProductLibrary.setFinancialProductStrike(mockExpiringMultiParty.address, {
          rawValue: strikePrice.toString()
        })
      )
    );
  });
  it("Library returns 1 price if before expiration", async () => {
    // Before expiration any input price should return 1e18 as each token is redeemable for 1 underlying WETH.
    assert.equal((await mockExpiringMultiParty.transformPrice({ rawValue: toWei("350") })).toString(), toWei("1")); // Calling the transformation function through the emp mock.

    assert.equal(
      (
        await mockExpiringMultiParty.transformPrice.call(
          { rawValue: toWei("350") },
          { from: mockExpiringMultiParty.address }
        )
      ).toString(),
      toWei("1")
    ); // Calling the transformation function as a mocked emp caller should also work
  });
});
