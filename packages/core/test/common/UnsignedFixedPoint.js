const hre = require("hardhat");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const FixedPointTest = getContract("UnsignedFixedPointTest");

describe("UnsignedFixedPoint", function () {
  let accounts;

  before(async function () {
    accounts = await web3.eth.getAccounts();
  });
  const uint_max = web3.utils.toBN("115792089237316195423570985008687907853269984665640564039457584007913129639935");

  it("Construction", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    assert.equal(await fixedPoint.methods.wrapFromUnscaledUint("53").call(), web3.utils.toWei("53"));

    // Reverts on overflow.
    const tenToSixty = web3.utils.toBN("10").pow(web3.utils.toBN("60"));
    assert(await didContractThrow(fixedPoint.methods.wrapFromUnscaledUint(tenToSixty).send({ from: accounts[0] })));
  });

  it("Unsigned Comparison", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    assert.isTrue(await fixedPoint.methods.wrapIsGreaterThan(web3.utils.toWei("2"), web3.utils.toWei("1")).call());
    assert.isFalse(await fixedPoint.methods.wrapIsGreaterThan(web3.utils.toWei("2"), web3.utils.toWei("2")).call());
    assert.isFalse(await fixedPoint.methods.wrapIsGreaterThan(web3.utils.toWei("2"), web3.utils.toWei("3")).call());

    assert.isFalse(await fixedPoint.methods.wrapIsLessThan(web3.utils.toWei("2"), web3.utils.toWei("1")).call());
    assert.isFalse(await fixedPoint.methods.wrapIsLessThan(web3.utils.toWei("2"), web3.utils.toWei("2")).call());
    assert.isTrue(await fixedPoint.methods.wrapIsLessThan(web3.utils.toWei("2"), web3.utils.toWei("3")).call());

    assert.isFalse(await fixedPoint.methods.wrapIsEqual(web3.utils.toWei("2"), web3.utils.toWei("1")).call());
    assert.isTrue(await fixedPoint.methods.wrapIsEqual(web3.utils.toWei("2"), web3.utils.toWei("2")).call());
    assert.isFalse(await fixedPoint.methods.wrapIsEqual(web3.utils.toWei("2"), web3.utils.toWei("3")).call());

    assert.isTrue(
      await fixedPoint.methods.wrapIsGreaterThanOrEqual(web3.utils.toWei("2"), web3.utils.toWei("1")).call()
    );
    assert.isTrue(
      await fixedPoint.methods.wrapIsGreaterThanOrEqual(web3.utils.toWei("2"), web3.utils.toWei("2")).call()
    );
    assert.isFalse(
      await fixedPoint.methods.wrapIsGreaterThanOrEqual(web3.utils.toWei("2"), web3.utils.toWei("3")).call()
    );

    assert.isFalse(await fixedPoint.methods.wrapIsLessThanOrEqual(web3.utils.toWei("2"), web3.utils.toWei("1")).call());
    assert.isTrue(await fixedPoint.methods.wrapIsLessThanOrEqual(web3.utils.toWei("2"), web3.utils.toWei("2")).call());
    assert.isTrue(await fixedPoint.methods.wrapIsLessThanOrEqual(web3.utils.toWei("2"), web3.utils.toWei("3")).call());
  });

  it("Unsigned Mixed Comparison", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    assert.isTrue(await fixedPoint.methods.wrapMixedIsEqual(web3.utils.toWei("2"), "2").call());
    assert.isTrue(await fixedPoint.methods.wrapMixedIsEqual(web3.utils.toWei("0"), "0").call());
    assert.isFalse(await fixedPoint.methods.wrapMixedIsEqual(web3.utils.toWei("1"), "3").call());

    assert.isTrue(await fixedPoint.methods.wrapMixedIsGreaterThan(web3.utils.toWei("2"), "1").call());
    assert.isFalse(await fixedPoint.methods.wrapMixedIsGreaterThan(web3.utils.toWei("2"), "2").call());
    assert.isFalse(await fixedPoint.methods.wrapMixedIsGreaterThan(web3.utils.toWei("2"), "3").call());

    assert.isTrue(await fixedPoint.methods.wrapMixedIsGreaterThanOrEqual(web3.utils.toWei("2"), "1").call());
    assert.isTrue(await fixedPoint.methods.wrapMixedIsGreaterThanOrEqual(web3.utils.toWei("2"), "2").call());
    assert.isFalse(await fixedPoint.methods.wrapMixedIsGreaterThanOrEqual(web3.utils.toWei("2"), "3").call());

    assert.isTrue(await fixedPoint.methods.wrapMixedIsGreaterThanOpposite("4", web3.utils.toWei("3")).call());
    assert.isFalse(await fixedPoint.methods.wrapMixedIsGreaterThanOpposite("3", web3.utils.toWei("3")).call());
    assert.isFalse(await fixedPoint.methods.wrapMixedIsGreaterThanOpposite("2", web3.utils.toWei("3")).call());

    assert.isTrue(await fixedPoint.methods.wrapMixedIsGreaterThanOrEqualOpposite("4", web3.utils.toWei("3")).call());
    assert.isTrue(await fixedPoint.methods.wrapMixedIsGreaterThanOrEqualOpposite("3", web3.utils.toWei("3")).call());
    assert.isFalse(await fixedPoint.methods.wrapMixedIsGreaterThanOrEqualOpposite("2", web3.utils.toWei("3")).call());

    assert.isFalse(await fixedPoint.methods.wrapMixedIsLessThan(web3.utils.toWei("2"), "1").call());
    assert.isFalse(await fixedPoint.methods.wrapMixedIsLessThan(web3.utils.toWei("2"), "2").call());
    assert.isTrue(await fixedPoint.methods.wrapMixedIsLessThan(web3.utils.toWei("2"), "3").call());

    assert.isFalse(await fixedPoint.methods.wrapMixedIsLessThanOrEqual(web3.utils.toWei("2"), "1").call());
    assert.isTrue(await fixedPoint.methods.wrapMixedIsLessThanOrEqual(web3.utils.toWei("2"), "2").call());
    assert.isTrue(await fixedPoint.methods.wrapMixedIsLessThanOrEqual(web3.utils.toWei("2"), "3").call());

    assert.isFalse(await fixedPoint.methods.wrapMixedIsLessThanOpposite("3", web3.utils.toWei("2")).call());
    assert.isFalse(await fixedPoint.methods.wrapMixedIsLessThanOpposite("2", web3.utils.toWei("2")).call());
    assert.isTrue(await fixedPoint.methods.wrapMixedIsLessThanOpposite("1", web3.utils.toWei("2")).call());

    assert.isFalse(await fixedPoint.methods.wrapMixedIsLessThanOrEqualOpposite("3", web3.utils.toWei("2")).call());
    assert.isTrue(await fixedPoint.methods.wrapMixedIsLessThanOrEqualOpposite("2", web3.utils.toWei("2")).call());
    assert.isTrue(await fixedPoint.methods.wrapMixedIsLessThanOrEqualOpposite("1", web3.utils.toWei("2")).call());
  });

  it("Minimum and Maximum", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    assert.equal((await fixedPoint.methods.wrapMin("5", "6").call()).toString(), "5");
    assert.equal((await fixedPoint.methods.wrapMax("5", "6").call()).toString(), "6");
  });

  it("Addition", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Additions below 10**18.
    let sum = await fixedPoint.methods.wrapAdd("99", "7").call();
    assert.equal(sum, "106");

    // Additions above 10**18.
    sum = await fixedPoint.methods.wrapAdd(web3.utils.toWei("99"), web3.utils.toWei("7")).call();
    assert.equal(sum, web3.utils.toWei("106"));

    // Reverts on overflow.
    // (uint_max-10) + 11 will overflow.
    assert(
      await didContractThrow(
        fixedPoint.methods.wrapAdd(uint_max.sub(web3.utils.toBN("10")), web3.utils.toBN("11")).call()
      )
    );
  });

  it("Mixed addition", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Basic mixed addition.
    const sum = await fixedPoint.methods.wrapMixedAdd(web3.utils.toWei("1.5"), "4").call();
    assert.equal(sum.toString(), web3.utils.toWei("5.5"));

    // Reverts if uint (second argument) can't be represented as an Unsigned.
    const tenToSixty = web3.utils.toBN("10").pow(web3.utils.toBN("60"));
    assert(await didContractThrow(fixedPoint.methods.wrapMixedAdd("0", tenToSixty).send({ from: accounts[0] })));

    // Reverts if both arguments can be represented but the sum overflows.
    // TODO: Add this annoying test case.
  });

  it("Subtraction", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Subtractions below 10**18.
    let sum = await fixedPoint.methods.wrapSub("99", "7").call();
    assert.equal(sum, "92");

    // Subtractions above 10**18.
    sum = await fixedPoint.methods.wrapSub(web3.utils.toWei("99"), web3.utils.toWei("7")).call();
    assert.equal(sum, web3.utils.toWei("92"));

    // Reverts on underflow.
    assert(await didContractThrow(fixedPoint.methods.wrapSub("1", "2").send({ from: accounts[0] })));
  });

  it("Mixed subtraction", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Basic mixed subtraction case.
    const difference = await fixedPoint.methods.wrapMixedSub(web3.utils.toWei("11.5"), "2").call();
    assert.equal(difference, web3.utils.toWei("9.5"));

    // Reverts if uint (second argument) can't be represented as an Unsigned.
    const tenToSixty = web3.utils.toBN("10").pow(web3.utils.toBN("60"));
    // 10**70 is the scaled version of 10**52, which can be represented. In this test case, we want to make sure
    // that the first argument is greater than the second, because that would be testing the underflow case instead.
    const tenToSeventy = web3.utils.toBN("10").pow(web3.utils.toBN("70"));
    assert(
      await didContractThrow(fixedPoint.methods.wrapMixedSub(tenToSeventy, tenToSixty).send({ from: accounts[0] }))
    );

    // Reverts on underflow (i.e., second argument larger than first).
    assert(await didContractThrow(fixedPoint.methods.wrapMixedSub(web3.utils.toWei("1.5"), "2").call()));
  });

  it("Mixed subtraction opposite", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Basic mixed subtraction case.
    const difference = await fixedPoint.methods.wrapMixedSubOpposite("10", web3.utils.toWei("5.5")).call();
    assert.equal(difference, web3.utils.toWei("4.5"));

    // Reverts on underflow (i.e., second argument larger than first).
    assert(await didContractThrow(fixedPoint.methods.wrapMixedSub("5", web3.utils.toWei("5.5")).call()));
  });

  it("Multiplication", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Whole numbers above 10**18.
    let product = await fixedPoint.methods.wrapMul(web3.utils.toWei("5"), web3.utils.toWei("17")).call();
    assert.equal(product.toString(), web3.utils.toWei("85"));

    // Fractions, no precision loss.
    product = await fixedPoint.methods.wrapMul(web3.utils.toWei("0.0001"), web3.utils.toWei("5")).call();
    assert.equal(product.toString(), web3.utils.toWei("0.0005"));

    // Fractions, precision loss, rounding down.
    // 1.2 * 2e-18 = 2.4e-18, which can't be represented and gets rounded down to 2.
    product = await fixedPoint.methods.wrapMul(web3.utils.toWei("1.2"), "2").call();
    assert.equal(product.toString(), "2");
    // 1e-18 * 1e-18 = 1e-36, which can't be represented and gets floor'd to 0.
    product = await fixedPoint.methods.wrapMul("1", "1").call();
    assert.equal(product.toString(), "0");

    // Reverts on overflow.
    // (uint_max - 1) * 2 overflows.
    assert(
      await didContractThrow(
        fixedPoint.methods.wrapMul(uint_max.sub(web3.utils.toBN("1")), web3.utils.toWei("2")).call()
      )
    );
  });

  it("Multiplication, with ceil", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Whole numbers above 10**18.
    let product = await fixedPoint.methods.wrapMulCeil(web3.utils.toWei("5"), web3.utils.toWei("17")).call();
    assert.equal(product.toString(), web3.utils.toWei("85"));

    // Fractions, no precision loss.
    product = await fixedPoint.methods.wrapMulCeil(web3.utils.toWei("0.0001"), web3.utils.toWei("5")).call();
    assert.equal(product.toString(), web3.utils.toWei("0.0005"));

    // Fractions, precision loss, ceiling.
    // 1.2 * 2e-18 = 2.4e-18, which can't be represented and gets ceil'd to 3.
    product = await fixedPoint.methods.wrapMulCeil(web3.utils.toWei("1.2"), "2").call();
    assert.equal(product.toString(), "3");
    // 1e-18 * 1e-18 = 1e-36, which can't be represented and gets ceil'd to 1e-18.
    product = await fixedPoint.methods.wrapMulCeil("1", "1").call();
    assert.equal(product.toString(), "1");

    // Reverts on overflow.
    // (uint_max - 1) * 2 overflows.
    assert(
      await didContractThrow(
        fixedPoint.methods.wrapMulCeil(uint_max.sub(web3.utils.toBN("1")), web3.utils.toWei("2")).call()
      )
    );
  });

  it("Mixed multiplication", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    let product = await fixedPoint.methods.wrapMixedMul(web3.utils.toWei("1.5"), "3").call();
    assert.equal(product, web3.utils.toWei("4.5"));

    // We can handle outputs up to 10^59.
    const tenToSixty = web3.utils.toBN("10").pow(web3.utils.toBN("60"));
    const tenToFiftyNine = web3.utils.toBN("10").pow(web3.utils.toBN("59"));
    product = await fixedPoint.methods.wrapMixedMul(web3.utils.toWei("0.1"), tenToSixty).call();
    assert.equal(product.toString(), web3.utils.toWei(tenToFiftyNine.toString()));

    // Reverts on overflow.
    // (uint_max / 2) * 3 overflows.
    assert(await didContractThrow(fixedPoint.methods.wrapMixedMul(uint_max.div(web3.utils.toBN("2")), "3").call()));
  });

  it("Mixed multiplication, with ceil", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    let product = await fixedPoint.methods.wrapMixedMulCeil(web3.utils.toWei("1.5"), "3").call();
    assert.equal(product, web3.utils.toWei("4.5"));

    // We can handle outputs up to 10^59.
    const tenToSixty = web3.utils.toBN("10").pow(web3.utils.toBN("60"));
    const tenToFiftyNine = web3.utils.toBN("10").pow(web3.utils.toBN("59"));
    product = await fixedPoint.methods.wrapMixedMulCeil(web3.utils.toWei("0.1"), tenToSixty).call();
    assert.equal(product.toString(), web3.utils.toWei(tenToFiftyNine.toString()));

    // Reverts on overflow.
    // (uint_max / 2) * 3 overflows.
    assert(await didContractThrow(fixedPoint.methods.wrapMixedMulCeil(uint_max.div(web3.utils.toBN("2")), "3").call()));
  });

  it("Division", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Normal division case.
    let quotient = await fixedPoint.methods.wrapDiv(web3.utils.toWei("150.3"), web3.utils.toWei("3")).call();
    assert.equal(quotient.toString(), web3.utils.toWei("50.1"));

    // Divisor < 1.
    quotient = await fixedPoint.methods.wrapDiv(web3.utils.toWei("2"), web3.utils.toWei("0.01")).call();
    assert.equal(quotient.toString(), web3.utils.toWei("200"));

    // Fractions, precision loss, rounding down.
    // 1 / 3 = 0.3 repeating, which can't be represented and gets rounded down to 0.333333333333333333.
    quotient = await fixedPoint.methods.wrapDiv(web3.utils.toWei("1"), web3.utils.toWei("3")).call();
    assert.equal(quotient.toString(), "3".repeat(18));
    // 1e-18 / 1e19 = 1e-37, which can't be represented and gets floor'd to 0.
    quotient = await fixedPoint.methods.wrapDiv("1", web3.utils.toWei(web3.utils.toWei("10"))).call();
    assert.equal(quotient.toString(), "0");

    // Reverts on division by zero.
    assert(await didContractThrow(fixedPoint.methods.wrapDiv("1", "0").send({ from: accounts[0] })));
  });

  it("Division, with ceil", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Normal division case.
    let quotient = await fixedPoint.methods.wrapDivCeil(web3.utils.toWei("150.3"), web3.utils.toWei("3")).call();
    assert.equal(quotient.toString(), web3.utils.toWei("50.1"));

    // Divisor < 1.
    quotient = await fixedPoint.methods.wrapDivCeil(web3.utils.toWei("2"), web3.utils.toWei("0.01")).call();
    assert.equal(quotient.toString(), web3.utils.toWei("200"));

    // Fractions, precision loss, rounding down.
    // 1 / 3 = 0.3 repeating, which can't be represented and gets rounded up to 0.333333333333333334.
    quotient = await fixedPoint.methods.wrapDivCeil(web3.utils.toWei("1"), web3.utils.toWei("3")).call();
    assert.equal(quotient.toString(), "3".repeat(17) + "4");
    // 1e-18 / 1e19 = 1e-37, which can't be represented and gets ceil'd to 1.
    quotient = await fixedPoint.methods.wrapDivCeil("1", web3.utils.toWei(web3.utils.toWei("10"))).call();
    assert.equal(quotient.toString(), "1");

    // Reverts on division by zero.
    assert(await didContractThrow(fixedPoint.methods.wrapDiv("1", "0").send({ from: accounts[0] })));
  });

  it("Mixed division", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Normal mixed division case.
    let quotient = await fixedPoint.methods.wrapMixedDiv(web3.utils.toWei("150.3"), "3").call();
    assert.equal(quotient.toString(), web3.utils.toWei("50.1"));

    // Reverts on division by zero.
    assert(await didContractThrow(fixedPoint.methods.wrapMixedDiv("1", "0").send({ from: accounts[0] })));

    // large denominator, should floor to 0
    const bigDenominator = web3.utils.toBN("10").pow(web3.utils.toBN("76"));
    quotient = await fixedPoint.methods.wrapMixedDiv(web3.utils.toWei("1"), bigDenominator).call();
    assert.equal(quotient.toString(), "0");
  });

  it("Mixed division, with ceil", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Normal mixed division case.
    let quotient = await fixedPoint.methods.wrapMixedDivCeil(web3.utils.toWei("150.3"), "3").call();
    assert.equal(quotient.toString(), web3.utils.toWei("50.1"));

    // Reverts on division by zero.
    assert(await didContractThrow(fixedPoint.methods.wrapMixedDivCeil("1", "0").send({ from: accounts[0] })));

    // large denominator, will overflow and revert because the denominator first needs to be cast to an Unsigned, {     // even though you'd think this should return '1'
    const bigDenominator = web3.utils.toBN("10").pow(web3.utils.toBN("76"));
    assert(
      await didContractThrow(
        fixedPoint.methods.wrapMixedDivCeil(web3.utils.toWei("1"), bigDenominator).send({ from: accounts[0] })
      )
    );
  });

  it("Mixed division opposite", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // Normal mixed division case.
    let quotient = await fixedPoint.methods.wrapMixedDivOpposite("120", web3.utils.toWei("3.2")).call();
    assert.equal(quotient.toString(), web3.utils.toWei("37.5"));

    // Reverts on division by zero.
    assert(await didContractThrow(fixedPoint.methods.wrapMixedDivOpposite("1", "0").send({ from: accounts[0] })));
  });

  it("Power", async function () {
    const fixedPoint = await FixedPointTest.new().send({ from: accounts[0] });

    // 1.5^0 = 1
    assert.equal(await fixedPoint.methods.wrapPow(web3.utils.toWei("1.5"), "0").call(), web3.utils.toWei("1"));

    // 1.5^1 = 1.5
    assert.equal(await fixedPoint.methods.wrapPow(web3.utils.toWei("1.5"), "1").call(), web3.utils.toWei("1.5"));

    // 1.5^2 = 2.25.
    assert.equal(await fixedPoint.methods.wrapPow(web3.utils.toWei("1.5"), "2").call(), web3.utils.toWei("2.25"));

    // 1.5^3 = 3.375
    assert.equal(await fixedPoint.methods.wrapPow(web3.utils.toWei("1.5"), "3").call(), web3.utils.toWei("3.375"));

    // Reverts on overflow
    assert(await didContractThrow(fixedPoint.methods.wrapPow(web3.utils.toWei("10"), "60").call()));
  });
});
