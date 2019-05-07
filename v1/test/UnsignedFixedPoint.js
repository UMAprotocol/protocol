const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const UnsignedFixedPointTest = artifacts.require("UnsignedFixedPointTest");

contract("UnsignedFixedPoint", function(accounts) {
  const uint_max = web3.utils.toBN("115792089237316195423570985008687907853269984665640564039457584007913129639935");

  it("Addition", async function() {
    const unsignedFixedPoint = await UnsignedFixedPointTest.new();

    // Additions below 10**18.
    let sum = await unsignedFixedPoint.wrapAdd("99", "7");
    assert.equal(sum, "106");

    // Additions above 10**18.
    sum = await unsignedFixedPoint.wrapAdd(web3.utils.toWei("99"), web3.utils.toWei("7"));
    assert.equal(sum, web3.utils.toWei("106"));

    // Reverts on overflow.
    // (uint_max-10) + 11 will overflow.
    assert(
      await didContractThrow(unsignedFixedPoint.wrapAdd(uint_max.sub(web3.utils.toBN("10")), web3.utils.toBN("11")))
    );
  });

  it("Subtraction", async function() {
    const unsignedFixedPoint = await UnsignedFixedPointTest.new();

    // Subtractions below 10**18.
    let sum = await unsignedFixedPoint.wrapSub("99", "7");
    assert.equal(sum, "92");

    // Subtractions above 10**18.
    sum = await unsignedFixedPoint.wrapSub(web3.utils.toWei("99"), web3.utils.toWei("7"));
    assert.equal(sum, web3.utils.toWei("92"));

    // Reverts on underflow.
    assert(await didContractThrow(unsignedFixedPoint.wrapSub("1", "2")));
  });

  it("Multiplication", async function() {
    const unsignedFixedPoint = await UnsignedFixedPointTest.new();

    // Whole numbers above 10**18.
    let product = await unsignedFixedPoint.wrapMul(web3.utils.toWei("5"), web3.utils.toWei("17"));
    assert.equal(product.toString(), web3.utils.toWei("85"));

    // Fractions, no precision loss.
    product = await unsignedFixedPoint.wrapMul(web3.utils.toWei("0.0001"), web3.utils.toWei("5"));
    assert.equal(product.toString(), web3.utils.toWei("0.0005"));

    // Fractions, precision loss, rounding down.
    // 1.2 * 2e-18 = 2.4e-18, which can't be represented and gets rounded down to 2.
    product = await unsignedFixedPoint.wrapMul(web3.utils.toWei("1.2"), "2");
    assert.equal(product.toString(), "2");

    // Reverts on overflow.
    // (uint_max - 1) * 2 overflows.
    assert(
      await didContractThrow(unsignedFixedPoint.wrapMul(uint_max.sub(web3.utils.toBN("1")), web3.utils.toWei("2")))
    );
  });

  it("Division", async function() {
    const unsignedFixedPoint = await UnsignedFixedPointTest.new();

    // Normal division case.
    let quotient = await unsignedFixedPoint.wrapDiv(web3.utils.toWei("150.3"), web3.utils.toWei("3"));
    assert.equal(quotient.toString(), web3.utils.toWei("50.1"));

    // Divisor < 1.
    quotient = await unsignedFixedPoint.wrapDiv(web3.utils.toWei("2"), web3.utils.toWei("0.01"));
    assert.equal(quotient.toString(), web3.utils.toWei("200"));

    // Fractions, precision loss, rounding down.
    // 1 / 3 = 0.3 repeating, which can't be represented and gets rounded down to 0.333333333333333333.
    quotient = await unsignedFixedPoint.wrapDiv(web3.utils.toWei("1"), web3.utils.toWei("3"));
    assert.equal(quotient.toString(), "3".repeat(18));

    // Reverts on division by zero.
    assert(await didContractThrow(unsignedFixedPoint.wrapDiv("1", "0")));
  });
});
