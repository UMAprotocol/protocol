const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const PreExpirationIdentifierTransformationFinancialProductLibrary = getContract(
  "PreExpirationIdentifierTransformationFinancialProductLibrary"
);

// Helper contracts
const Timer = getContract("Timer");
const ExpiringMultiPartyMock = getContract("ExpiringMultiPartyMock");

const { toWei, hexToUtf8, utf8ToHex } = web3.utils;
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const transformedPriceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER_TRANSFORMED");
const collateralizationRatio = toWei("1.2");

describe("PreExpirationIdentifierTransformationFinancialProductLibrary", function () {
  let identifierTransformationFPL;
  let expiringMultiParty;
  let timer;
  let expirationTime;
  let accounts;

  before(async () => {
    await runDefaultFixture(hre);
    accounts = await hre.web3.eth.getAccounts();
    timer = await Timer.deployed();

    expirationTime = (await timer.methods.getCurrentTime().call()) + 100; // use 100 seconds in the future as the expiration time.
    identifierTransformationFPL = await PreExpirationIdentifierTransformationFinancialProductLibrary.new().send({
      from: accounts[0],
    });
    expiringMultiParty = await ExpiringMultiPartyMock.new(
      identifierTransformationFPL.options.address,
      expirationTime,
      { rawValue: collateralizationRatio.toString() },
      priceFeedIdentifier,
      timer.options.address
    ).send({ from: accounts[0] });

    await identifierTransformationFPL.methods
      .setFinancialProductTransformedIdentifier(expiringMultiParty.options.address, transformedPriceFeedIdentifier)
      .send({ from: accounts[0] });
  });
  it("Transformation correctly set", async () => {
    assert.equal(
      hexToUtf8(
        await identifierTransformationFPL.methods
          .getTransformedIdentifierForFinancialProduct(expiringMultiParty.options.address)
          .call()
      ),
      hexToUtf8(transformedPriceFeedIdentifier)
    );
  });
  it("Can not re-set the transformation for a given financial product", async () => {
    assert(
      await didContractThrow(
        identifierTransformationFPL.methods
          .setFinancialProductTransformedIdentifier(expiringMultiParty.options.address, transformedPriceFeedIdentifier)
          .send({ from: accounts[0] })
      )
    );
  });
  it("Correctly transforms the identifier pre-expiration", async () => {
    // Calling the transformation function through the emp mock.
    assert.equal(
      hexToUtf8(
        await expiringMultiParty.methods
          .transformPriceIdentifier((await expiringMultiParty.methods.getCurrentTime().call()).toString())
          .call()
      ),
      hexToUtf8(transformedPriceFeedIdentifier)
    );

    // Calling the transformation function as a mocked emp caller should also work.
    assert.equal(
      hexToUtf8(
        await expiringMultiParty.methods
          .transformPriceIdentifier((await expiringMultiParty.methods.getCurrentTime().call()).toString())
          .call({ from: expiringMultiParty.options.address })
      ),
      hexToUtf8(transformedPriceFeedIdentifier)
    );
  });
  it("Preforms no transformation on the identifier post-expiration", async () => {
    await timer.methods.setCurrentTime(expirationTime + 1).send({ from: accounts[0] });

    // Calling the transformation function through the emp mock.
    assert.equal(
      hexToUtf8(
        await expiringMultiParty.methods
          .transformPriceIdentifier((await expiringMultiParty.methods.getCurrentTime().call()).toString())
          .call()
      ),
      hexToUtf8(priceFeedIdentifier)
    );

    // Calling the transformation function as a mocked emp caller should also work.
    assert.equal(
      hexToUtf8(
        await expiringMultiParty.methods
          .transformPriceIdentifier((await expiringMultiParty.methods.getCurrentTime().call()).toString())
          .call({ from: expiringMultiParty.options.address })
      ),
      hexToUtf8(priceFeedIdentifier)
    );
  });
});
