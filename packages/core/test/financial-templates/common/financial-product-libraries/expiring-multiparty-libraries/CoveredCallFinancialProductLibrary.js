const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const CoveredCallFinancialProductLibrary = getContract("CoveredCallFinancialProductLibrary");

// Helper contracts
const Timer = getContract("Timer");
const ExpiringMultiPartyMock = getContract("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const strikePrice = toBN(toWei("400"));
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralizationRatio = toBN(toWei("1")).addn(1);

describe("CoveredCallFinancialProductLibrary", function () {
  let coveredCallFPL;
  let expiringMultiParty;
  let timer;
  let expirationTime;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
    timer = await Timer.deployed();

    expirationTime = (await timer.methods.getCurrentTime().call()) + 100; // use 100 seconds in the future as the expiration time.
    coveredCallFPL = await CoveredCallFinancialProductLibrary.new().send({ from: accounts[0] });
    expiringMultiParty = await ExpiringMultiPartyMock.new(
      coveredCallFPL.options.address,
      expirationTime,
      { rawValue: collateralizationRatio.toString() },
      priceFeedIdentifier,
      timer.options.address
    ).send({ from: accounts[0] });

    await coveredCallFPL.methods
      .setFinancialProductStrike(expiringMultiParty.options.address, { rawValue: strikePrice.toString() })
      .send({ from: accounts[0] });
  });
  it("Strike correctly set", async () => {
    assert.equal(
      (await coveredCallFPL.methods.getStrikeForFinancialProduct(expiringMultiParty.options.address).call()).toString(),
      strikePrice.toString()
    );
  });
  describe("price transformation", () => {
    it("Can not re-set the strike for a given financial product", async () => {
      assert(
        await didContractThrow(
          coveredCallFPL.methods
            .setFinancialProductStrike(expiringMultiParty.options.address, { rawValue: strikePrice.toString() })
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set strike price for invalid financial product", async () => {
      assert(
        await didContractThrow(
          coveredCallFPL.methods
            .setFinancialProductStrike(ZERO_ADDRESS, { rawValue: strikePrice.toString() })
            .send({ from: accounts[0] })
        )
      );
      assert(
        await didContractThrow(
          coveredCallFPL.methods
            .setFinancialProductStrike(timer.options.address, { rawValue: strikePrice.toString() })
            .send({ from: accounts[0] })
        )
      );
    });
    it("Library returns 1 price if before expiration", async () => {
      // Calling the transformation function through the emp mock.
      assert.equal(
        (
          await expiringMultiParty.methods
            .transformPrice(
              { rawValue: toWei("350") },
              (await expiringMultiParty.methods.getCurrentTime().call()).toString()
            )
            .call()
        ).toString(),
        toWei("1")
      );

      // Calling the transformation function as a mocked emp caller should also work.
      assert.equal(
        (
          await expiringMultiParty.methods
            .transformPrice(
              { rawValue: toWei("350") },
              (await expiringMultiParty.methods.getCurrentTime().call()).toString()
            )
            .call({ from: expiringMultiParty.options.address })
        ).toString(),
        toWei("1")
      );
    });

    it("Library returns correctly transformed price after expiration", async () => {
      await timer.methods.setCurrentTime(expirationTime + 1).send({ from: accounts[0] });

      // If the oracle price is less than the strike price then the library should return 0 (the option is out the money).
      assert.equal(
        (
          await expiringMultiParty.methods
            .transformPrice(
              { rawValue: toWei("350") },
              (await expiringMultiParty.methods.getCurrentTime().call()).toString()
            )
            .call()
        ).toString(),
        "0"
      );

      // Else, if the oracle price is more than strike then the library should return the (oraclePrice - strikePrice) / oraclePrice.// Token expires to be worth the fraction of an collateral token that's in the money. eg if ETHUSD is $500 and
      // strike is $400, token is redeemable for 100 / 500 = 0.2 WETH (worth $100).
      assert.equal(
        (
          await expiringMultiParty.methods
            .transformPrice(
              { rawValue: toWei("500") },
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
      // Under all scenarios, the collateral requirement of the contract should be 1 as this is a fully covered call.

      // Check pre-expiration below strike
      assert.equal(
        (await expiringMultiParty.methods.transformCollateralRequirement({ rawValue: toWei("350") }).call()).toString(),
        toWei("1")
      );
      // Check pre-expiration above strike
      assert.equal(
        (await expiringMultiParty.methods.transformCollateralRequirement({ rawValue: toWei("450") }).call()).toString(),
        toWei("1")
      );

      // advance the timer after expiration and ensure the CR is still 1.
      await timer.methods.setCurrentTime(expirationTime + 1).send({ from: accounts[0] });

      // Check post-expiration below strike
      assert.equal(
        (await expiringMultiParty.methods.transformCollateralRequirement({ rawValue: toWei("350") }).call()).toString(),
        toWei("1")
      );
      // Check post-expiration above strike
      assert.equal(
        (await expiringMultiParty.methods.transformCollateralRequirement({ rawValue: toWei("450") }).call()).toString(),
        toWei("1")
      );
    });
  });
});
