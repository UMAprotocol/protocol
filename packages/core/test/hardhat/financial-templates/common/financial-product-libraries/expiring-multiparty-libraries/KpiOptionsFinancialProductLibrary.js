const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { assert } = require("chai");

// Tested Contract
const KpiOptionsFinancialProductLibrary = getContract("KpiOptionsFinancialProductLibrary");

// Helper contracts
const Timer = getContract("Timer");
const ExpiringMultiPartyMock = getContract("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralizationRatio = toBN(toWei("1")).addn(1);

describe("KpiOptionsFinancialProductLibrary", function () {
  let kpiFPL;
  let expiringMultiParty;
  let timer;
  let expirationTime;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
    timer = await Timer.deployed();

    expirationTime = (await timer.methods.getCurrentTime().call()) + 100; // use 100 seconds in the future as the expiration time.
    kpiFPL = await KpiOptionsFinancialProductLibrary.new().send({ from: accounts[0] });
    expiringMultiParty = await ExpiringMultiPartyMock.new(
      kpiFPL.options.address,
      expirationTime,
      { rawValue: collateralizationRatio.toString() },
      priceFeedIdentifier,
      timer.options.address
    ).send({ from: accounts[0] });
  });
  describe("price transformation", () => {
    it("Library returns 2 price if before expiration", async () => {
      // Calling the transformation function through the emp mock.
      assert.equal(
        (
          await expiringMultiParty.methods
            .transformPrice(
              { rawValue: toWei("1") },
              (await expiringMultiParty.methods.getCurrentTime().call()).toString()
            )
            .call()
        ).toString(),
        toWei("2")
      );

      // Calling the transformation function as a mocked emp caller should also work.
      assert.equal(
        (
          await expiringMultiParty.methods
            .transformPrice(
              { rawValue: toWei("1") },
              (await expiringMultiParty.methods.getCurrentTime().call()).toString()
            )
            .call({ from: expiringMultiParty.options.address })
        ).toString(),
        toWei("2")
      );
    });

    it("Library returns correctly transformed price after expiration", async () => {
      await timer.methods.setCurrentTime(expirationTime + 1).send({ from: accounts[0] });

      // If transformPrice is called after expiration, no transformation should occur.
      assert.equal(
        (
          await expiringMultiParty.methods
            .transformPrice(
              { rawValue: toWei("0.2") },
              (await expiringMultiParty.methods.getCurrentTime().call()).toString()
            )
            .call()
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
        (await expiringMultiParty.methods.transformCollateralRequirement({ rawValue: toWei("0.1") }).call()).toString(),
        toWei("1")
      );

      // advance the timer after expiration and ensure the CR is still 1.
      await timer.methods.setCurrentTime(expirationTime + 1).send({ from: accounts[0] });

      // Check post-expiration
      assert.equal(
        (await expiringMultiParty.methods.transformCollateralRequirement({ rawValue: toWei("0.2") }).call()).toString(),
        toWei("1")
      );
    });
  });
});
