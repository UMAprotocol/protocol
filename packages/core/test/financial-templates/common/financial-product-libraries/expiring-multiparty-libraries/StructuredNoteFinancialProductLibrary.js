const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const StructuredNoteFinancialProductLibrary = getContract("StructuredNoteFinancialProductLibrary");

// Helper contracts
const Timer = getContract("Timer");
const ExpiringMultiPartyMock = getContract("ExpiringMultiPartyMock");

const { toWei, toBN, utf8ToHex } = web3.utils;
const strikePrice = toBN(toWei("400"));
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralizationRatio = toWei("1.2");

describe("StructuredNoteFinancialProductLibrary", function () {
  let structuredNoteFPL;
  let expiringMultiParty;
  let timer;
  let expirationTime;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
    timer = await Timer.deployed();

    expirationTime = (await timer.methods.getCurrentTime().call()) + 100; // use 100 seconds in the future as the expiration time.
    structuredNoteFPL = await StructuredNoteFinancialProductLibrary.new().send({ from: accounts[0] });
    expiringMultiParty = await ExpiringMultiPartyMock.new(
      structuredNoteFPL.options.address,
      expirationTime,
      { rawValue: collateralizationRatio.toString() },
      priceFeedIdentifier,
      timer.options.address
    ).send({ from: accounts[0] });

    await structuredNoteFPL.methods
      .setFinancialProductStrike(expiringMultiParty.options.address, { rawValue: strikePrice.toString() })
      .send({ from: accounts[0] });
  });
  it("Strike correctly set", async () => {
    assert.equal(
      (
        await structuredNoteFPL.methods.getStrikeForFinancialProduct(expiringMultiParty.options.address).call()
      ).toString(),
      strikePrice.toString()
    );
  });
  describe("price transformation", () => {
    it("Can not re-set the strike for a given financial product", async () => {
      assert(
        await didContractThrow(
          structuredNoteFPL.methods
            .setFinancialProductStrike(expiringMultiParty.options.address, { rawValue: strikePrice.toString() })
            .send({ from: accounts[0] })
        )
      );
    });
    it("Can not set strike price for invalid financial product", async () => {
      assert(
        await didContractThrow(
          structuredNoteFPL.methods
            .setFinancialProductStrike(ZERO_ADDRESS, { rawValue: strikePrice.toString() })
            .send({ from: accounts[0] })
        )
      );
      assert(
        await didContractThrow(
          structuredNoteFPL.methods
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

      // If the oracle price is less than the strike price then the library should return 1.
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

      // Else, if the oracle price is more than strike then the library should return the strike/oracle price. For a oracle
      // price of 500 each token is redeemable for 400/500 = 0.8 WETH.
      assert.equal(
        (
          await expiringMultiParty.methods
            .transformPrice(
              { rawValue: toWei("500") },
              (await expiringMultiParty.methods.getCurrentTime().call()).toString()
            )
            .call()
        ).toString(),
        toWei("0.8")
      );
    });
  });
  describe("Collateralization ratio transformation", () => {
    it("Library returns correctly transformed collateralization ratio", async () => {
      // Create a fictitious CR for the financial product. Based on the oracle price this required CR should be scalled accordingly.
      await timer.methods.setCurrentTime(expirationTime + 1).send({ from: accounts[0] });

      // If the oracle price is less than the strike price then the library should return the original CR.
      assert.equal(
        (await expiringMultiParty.methods.transformCollateralRequirement({ rawValue: toWei("350") }).call()).toString(),
        collateralizationRatio
      );

      // Else, if the oracle price is more than strike then the library should return the collateralization ratio scaled
      // by strike/oracle price. For a oracle price of 500  and a CR of 1.2 the library should return 400 / 500 * 1.2 = 0.96
      assert.equal(
        (await expiringMultiParty.methods.transformCollateralRequirement({ rawValue: toWei("500") }).call()).toString(),
        toWei("0.96")
      );
      // For a oracle price of 1000  and a CR of 1.2 the library should return 400 / 1000 * 1.2 = 0.48
      assert.equal(
        (
          await expiringMultiParty.methods.transformCollateralRequirement({ rawValue: toWei("1000") }).call()
        ).toString(),
        toWei("0.48")
      );
    });
  });
});
