const { didContractThrow } = require("../../common/SolidityTestUtils.js");

const FixedPointTest = artifacts.require("FixedPointTest");

contract("FixedPoint", function(accounts) {
  const uint_max = web3.utils.toBN("115792089237316195423570985008687907853269984665640564039457584007913129639935");

  it("Addition", async function() {
    const FixedPoint = await FixedPointTest.new();

    // Additions below 10**18.
    let sum = await FixedPoint.wrapAdd("99", "7");
    assert.equal(sum, "106");

    // Additions above 10**18.
    sum = await FixedPoint.wrapAdd(web3.utils.toWei("99"), web3.utils.toWei("7"));
    assert.equal(sum, web3.utils.toWei("106"));

    // Reverts on overflow.
    // (uint_max-10) + 11 will overflow.
    assert(await didContractThrow(FixedPoint.wrapAdd(uint_max.sub(web3.utils.toBN("10")), web3.utils.toBN("11"))));
  });

  it("Subtraction", async function() {
    const FixedPoint = await FixedPointTest.new();

    // Subtractions below 10**18.
    let sum = await FixedPoint.wrapSub("99", "7");
    assert.equal(sum, "92");

    // Subtractions above 10**18.
    sum = await FixedPoint.wrapSub(web3.utils.toWei("99"), web3.utils.toWei("7"));
    assert.equal(sum, web3.utils.toWei("92"));

    // Reverts on underflow.
    assert(await didContractThrow(FixedPoint.wrapSub("1", "2")));
  });

  it("Multiplication", async function() {
    const FixedPoint = await FixedPointTest.new();

    // Whole numbers above 10**18.
    let product = await FixedPoint.wrapMul(web3.utils.toWei("5"), web3.utils.toWei("17"));
    assert.equal(product.toString(), web3.utils.toWei("85"));

    // Fractions, no precision loss.
    product = await FixedPoint.wrapMul(web3.utils.toWei("0.0001"), web3.utils.toWei("5"));
    assert.equal(product.toString(), web3.utils.toWei("0.0005"));

    // Fractions, precision loss, rounding down.
    // 1.2 * 2e-18 = 2.4e-18, which can't be represented and gets rounded down to 2.
    product = await FixedPoint.wrapMul(web3.utils.toWei("1.2"), "2");
    assert.equal(product.toString(), "2");

    // Reverts on overflow.
    // (uint_max - 1) * 2 overflows.
    assert(await didContractThrow(FixedPoint.wrapMul(uint_max.sub(web3.utils.toBN("1")), web3.utils.toWei("2"))));
  });

  it("Division", async function() {
    const FixedPoint = await FixedPointTest.new();

    // Normal division case.
    let quotient = await FixedPoint.wrapDiv(web3.utils.toWei("150.3"), web3.utils.toWei("3"));
    assert.equal(quotient.toString(), web3.utils.toWei("50.1"));

    // Divisor < 1.
    quotient = await FixedPoint.wrapDiv(web3.utils.toWei("2"), web3.utils.toWei("0.01"));
    assert.equal(quotient.toString(), web3.utils.toWei("200"));

    // Fractions, precision loss, rounding down.
    // 1 / 3 = 0.3 repeating, which can't be represented and gets rounded down to 0.333333333333333333.
    quotient = await FixedPoint.wrapDiv(web3.utils.toWei("1"), web3.utils.toWei("3"));
    assert.equal(quotient.toString(), "3".repeat(18));

    // Reverts on division by zero.
    assert(await didContractThrow(FixedPoint.wrapDiv("1", "0")));
  });
});
