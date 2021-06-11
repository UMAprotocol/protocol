const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const PreExpirationIdentifierTransformationFinancialProductLibrary = artifacts.require(
  "PreExpirationIdentifierTransformationFinancialProductLibrary"
);

// Helper contracts
const Timer = artifacts.require("Timer");
const ExpiringMultiPartyMock = artifacts.require("ExpiringMultiPartyMock");

const { toWei, hexToUtf8, utf8ToHex } = web3.utils;
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const transformedPriceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER_TRANSFORMED");
const collateralizationRatio = toWei("1.2");

contract("PreExpirationIdentifierTransformationFinancialProductLibrary", function () {
  let identifierTransformationFPL;
  let expiringMultiParty;
  let timer;
  let expirationTime;

  beforeEach(async () => {
    timer = await Timer.deployed();

    expirationTime = (await timer.getCurrentTime()) + 100; // use 100 seconds in the future as the expiration time.
    identifierTransformationFPL = await PreExpirationIdentifierTransformationFinancialProductLibrary.new();
    expiringMultiParty = await ExpiringMultiPartyMock.new(
      identifierTransformationFPL.address,
      expirationTime,
      { rawValue: collateralizationRatio.toString() },
      priceFeedIdentifier,
      timer.address
    );

    await identifierTransformationFPL.setFinancialProductTransformedIdentifier(
      expiringMultiParty.address,
      transformedPriceFeedIdentifier
    );
  });
  it("Transformation correctly set", async () => {
    assert.equal(
      hexToUtf8(
        await identifierTransformationFPL.getTransformedIdentifierForFinancialProduct(expiringMultiParty.address)
      ),
      hexToUtf8(transformedPriceFeedIdentifier)
    );
  });
  it("Can not re-set the transformation for a given financial product", async () => {
    assert(
      await didContractThrow(
        identifierTransformationFPL.setFinancialProductTransformedIdentifier(
          expiringMultiParty.address,
          transformedPriceFeedIdentifier
        )
      )
    );
  });
  it("Correctly transforms the identifier pre-expiration", async () => {
    // Calling the transformation function through the emp mock.
    assert.equal(
      hexToUtf8(
        await expiringMultiParty.transformPriceIdentifier((await expiringMultiParty.getCurrentTime()).toString())
      ),
      hexToUtf8(transformedPriceFeedIdentifier)
    );

    // Calling the transformation function as a mocked emp caller should also work.
    assert.equal(
      hexToUtf8(
        await expiringMultiParty.transformPriceIdentifier.call((await expiringMultiParty.getCurrentTime()).toString(), {
          from: expiringMultiParty.address,
        })
      ),
      hexToUtf8(transformedPriceFeedIdentifier)
    );
  });
  it("Preforms no transformation on the identifier post-expiration", async () => {
    await timer.setCurrentTime(expirationTime + 1);

    // Calling the transformation function through the emp mock.
    assert.equal(
      hexToUtf8(
        await expiringMultiParty.transformPriceIdentifier((await expiringMultiParty.getCurrentTime()).toString())
      ),
      hexToUtf8(priceFeedIdentifier)
    );

    // Calling the transformation function as a mocked emp caller should also work.
    assert.equal(
      hexToUtf8(
        await expiringMultiParty.transformPriceIdentifier.call((await expiringMultiParty.getCurrentTime()).toString(), {
          from: expiringMultiParty.address,
        })
      ),
      hexToUtf8(priceFeedIdentifier)
    );
  });
});
