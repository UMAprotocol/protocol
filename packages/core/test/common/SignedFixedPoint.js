const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const SignedFixedPointTest = artifacts.require("SignedFixedPointTest");

const { toWei, fromWei, toBN } = web3.utils;

contract("SignedFixedPoint", function() {
  const int_max = toBN("57896044618658097711785492504343953926634992332820282019728792003956564819967");
  const int_min = toBN("-57896044618658097711785492504343953926634992332820282019728792003956564819968");

  it("Construction", async function() {
    const fixedPoint = await SignedFixedPointTest.new();

    assert.equal(await fixedPoint.wrapFromUnscaledInt("-53"), toWei("-53"));
    assert.equal(await fixedPoint.wrapFromUnscaledInt("495"), toWei("495"));

    // Reverts on overflow.
    const tenToFiftyEight = toBN("10").pow(toBN("59"));
    assert(await didContractThrow(fixedPoint.wrapFromUnscaledInt(tenToFiftyEight)));

    // Signed -> Unsigned
    assert.equal(await fixedPoint.wrapFromSigned(toWei("100")), toWei("100"));
    assert.equal(await fixedPoint.wrapFromSigned("0"), "0");
    assert.equal(await fixedPoint.wrapFromSigned(int_max), int_max.toString());
    assert(await didContractThrow(fixedPoint.wrapFromSigned("-1")));
    assert(await didContractThrow(fixedPoint.wrapFromSigned(int_min)));

    // Unsigned -> Signed
    assert.equal(await fixedPoint.wrapFromUnsigned(toWei("100")), toWei("100"));
    assert.equal(await fixedPoint.wrapFromSigned("0"), "0");
    assert.equal(await fixedPoint.wrapFromUnsigned(int_max), int_max.toString());
    assert(await didContractThrow(fixedPoint.wrapFromUnsigned(int_max.addn(1))));
  });

  // This function tests all positive and negative variations/combinations of an input pair.
  // a and b are the input js numbers.
  // contractFn is the async function that will be called on the contract.
  // jsFn is the equivalent js function that should generate the same result as the contract function.
  // convInputs is a function that takes the inputs and converts them to a version that solidity can handle.
  // convOut is a function that will take the output of the solidity function and convert it to something that is comparable to the output of the js function.
  const checkMatchingComputation = async (a, b, contractFn, jsFn, convIn, convOut, fname) => {
    assert.equal(convOut(await contractFn(...convIn(a, b))), jsFn(a, b), `fname: ${fname}, inputs: ${a}, ${b}`);
    assert.equal(convOut(await contractFn(...convIn(-a, b))), jsFn(-a, b), `fname: ${fname}, inputs: ${-a}, ${b}`);
    assert.equal(convOut(await contractFn(...convIn(a, -b))), jsFn(a, -b), `fname: ${fname}, inputs: ${a}, ${-b}`);
    assert.equal(convOut(await contractFn(...convIn(-a, -b))), jsFn(-a, -b), `fname: ${fname}, inputs: ${-a}, ${-b}`);
    assert.equal(convOut(await contractFn(...convIn(b, a))), jsFn(b, a), `fname: ${fname}, inputs: ${b}, ${a}`);
    assert.equal(convOut(await contractFn(...convIn(-b, a))), jsFn(-b, a), `fname: ${fname}, inputs: ${-b}, ${a}`);
    assert.equal(convOut(await contractFn(...convIn(b, -a))), jsFn(b, -a), `fname: ${fname}, inputs: ${b}, ${-a}`);
    assert.equal(convOut(await contractFn(...convIn(-b, -a))), jsFn(-b, -a), `fname: ${fname}, inputs: ${-b}, ${-a}`);
  };

  // A convenient list of js comparison functions that can be passed around.
  const lt = (a, b) => a < b;
  const lte = (a, b) => a <= b;
  const gt = (a, b) => a > b;
  const gte = (a, b) => a >= b;
  const eq = (a, b) => a === b;

  // toWei wrapper that takes js numbers rather than strings.
  const numToWei = a => toWei(a.toString());

  it("Comparison", async function() {
    const fixedPoint = await SignedFixedPointTest.new();

    // Pairs of inputs that will be provided to each comparison functions.
    const inputPairs = [
      [1, 3],
      [2, 2],
      [0, 0]
    ];

    // A list of equivalent contract and js functions that we'd like to compare the output to.
    const functionPairs = [
      [fixedPoint.wrapIsGreaterThan, gt, "isGreaterThan"],
      [fixedPoint.wrapIsGreaterThanOrEqual, gte, "isGreaterThanOrEqual"],
      [fixedPoint.wrapIsEqual, eq, "isEqual"],
      [fixedPoint.wrapIsLessThanOrEqual, lte, "isLessThanOrEqual"],
      [fixedPoint.wrapIsLessThan, lt, "isLessThan"]
    ];

    for (const [a, b] of inputPairs) {
      for (const [contractFn, jsFn, fname] of functionPairs) {
        // Combine each pair of inputs with each pair of js and contract function to test each combination.
        // Note: the inputs are converted toWei to make them fairly standard numbers in solidity.
        // Note: the output doesn't need to be converted since it is just a boolean (like js).
        await checkMatchingComputation(
          a,
          b,
          contractFn,
          jsFn,
          (...args) => args.map(numToWei),
          out => out,
          fname
        );
      }
    }
  });

  it("Mixed Comparison", async function() {
    const fixedPoint = await SignedFixedPointTest.new();

    // Pairs of inputs that will be provided to each comparison functions.
    const inputPairs = [
      [1, 3],
      [2, 2],
      [0, 0]
    ];

    const functionPairs = [
      [fixedPoint.wrapMixedIsGreaterThan, gt, (a, b) => [numToWei(a), b], "mixedIsGreaterThan"],
      [fixedPoint.wrapMixedIsGreaterThanOrEqual, gte, (a, b) => [numToWei(a), b], "mixedIsGreaterThanOrEqual"],
      [fixedPoint.wrapMixedIsEqual, eq, (a, b) => [numToWei(a), b], "mixedIsEqual"],
      [fixedPoint.wrapMixedIsLessThanOrEqual, lte, (a, b) => [numToWei(a), b], "mixedIsLessThanOrEqual"],
      [fixedPoint.wrapMixedIsLessThan, lt, (a, b) => [numToWei(a), b], "mixedIsLessThan"],
      [fixedPoint.wrapMixedIsGreaterThanOpposite, gt, (a, b) => [a, numToWei(b)], "mixedIsGreaterThanOpposite"],
      [
        fixedPoint.wrapMixedIsGreaterThanOrEqualOpposite,
        gte,
        (a, b) => [a, numToWei(b)],
        "mixedIsGreaterThanOrEqualOpposite"
      ],
      [
        fixedPoint.wrapMixedIsLessThanOrEqualOpposite,
        lte,
        (a, b) => [a, numToWei(b)],
        "mixedIsLessThanOrEqualOpposite"
      ],
      [fixedPoint.wrapMixedIsLessThanOpposite, lt, (a, b) => [a, numToWei(b)], "mixedIsLessThanOpposite"]
    ];

    for (const [a, b] of inputPairs) {
      for (const [contractFn, jsFn, inConv, fname] of functionPairs) {
        // Combine each pair of inputs with each pair of js and contract function to test each combination.
        // Note: this uses a custom input converter to handle the mixed versions.
        await checkMatchingComputation(a, b, contractFn, jsFn, inConv, out => out, fname);
      }
    }
  });

  it("Minimum and Maximum", async function() {
    const fixedPoint = await SignedFixedPointTest.new();

    const inputPairs = [
      [5, 6],
      [100, 0],
      [2390123, 9320492],
      [0.001, 234]
    ];

    const functionPairs = [
      [fixedPoint.wrapMin, Math.min, "min"],
      [fixedPoint.wrapMax, Math.max, "max"]
    ];

    for (const [a, b] of inputPairs) {
      for (const [contractFn, jsFn, fname] of functionPairs) {
        // Combine each pair of inputs with each pair of js and contract function to test each combination.
        // toWei all inputs.
        // fromWei and convert all outputs to numbers.
        await checkMatchingComputation(
          a,
          b,
          contractFn,
          jsFn,
          (...args) => args.map(numToWei),
          out => Number(fromWei(out)),
          fname
        );
      }
    }
  });

  it("Basic addition and subtraction", async function() {
    const fixedPoint = await SignedFixedPointTest.new();
    const add = (a, b) => a + b;
    const sub = (a, b) => a - b;

    const inputPairs = [
      [5, 6],
      [100, 0],
      [2390123, 9320492],
      [1, 234]
    ];

    const functionPairs = [
      [fixedPoint.wrapAdd, add, (...args) => args.map(numToWei), "add"],
      [fixedPoint.wrapSub, sub, (...args) => args.map(numToWei), "sub"],
      [fixedPoint.wrapMixedAdd, add, (a, b) => [numToWei(a), b], "mixedAdd"],
      [fixedPoint.wrapMixedSub, sub, (a, b) => [numToWei(a), b], "mixedSub"],
      [fixedPoint.wrapMixedSubOpposite, sub, (a, b) => [a, numToWei(b)], "mixedSubOpposite"]
    ];

    for (const [a, b] of inputPairs) {
      for (const [contractFn, jsFn, convIn, fname] of functionPairs) {
        // Combine each pair of inputs with each pair of js and contract function to test each combination.
        // fromWei and convert all outputs to numbers.
        await checkMatchingComputation(a, b, contractFn, jsFn, convIn, out => Number(fromWei(out)), fname);
      }
    }
  });

  it("Basic multipication and division", async function() {
    const fixedPoint = await SignedFixedPointTest.new();
    const mul = (a, b) => a * b;
    const div = (a, b) => a / b;

    const inputPairs = [
      [5, 6],
      [100, 32],
      [2390123, 9320492]
    ];

    const functionPairs = [
      [fixedPoint.wrapMul, mul, (...args) => args.map(numToWei), "mul"],
      [fixedPoint.wrapMulAwayFromZero, mul, (...args) => args.map(numToWei), "mul"],
      [fixedPoint.wrapDiv, div, (...args) => args.map(numToWei), "div"],
      [fixedPoint.wrapDivAwayFromZero, div, (...args) => args.map(numToWei), "div"],
      [fixedPoint.wrapMixedMul, mul, (a, b) => [numToWei(a), b], "mixedMul"],
      [fixedPoint.wrapMixedMulAwayFromZero, mul, (a, b) => [numToWei(a), b], "mixedMul"],
      [fixedPoint.wrapMixedDiv, div, (a, b) => [numToWei(a), b], "mixedDiv"],
      [fixedPoint.wrapMixedDivAwayFromZero, div, (a, b) => [numToWei(a), b], "mixedDiv"],
      [fixedPoint.wrapMixedDivOpposite, div, (a, b) => [a, numToWei(b)], "mixedDivOpposite"]
    ];

    for (const [a, b] of inputPairs) {
      for (const [contractFn, jsFn, convIn, fname] of functionPairs) {
        // Combine each pair of inputs with each pair of js and contract function to test each combination.
        // fromWei and convert all outputs to numbers.
        await checkMatchingComputation(a, b, contractFn, jsFn, convIn, out => Number(fromWei(out)), fname);
      }
    }
  });

  it("Addition/Subtraction Overflow/Underflow", async function() {
    const fixedPoint = await SignedFixedPointTest.new();

    // Reverts on overflow.
    // (int_max-10) + 11 will overflow.
    assert(await didContractThrow(fixedPoint.wrapAdd(int_max.sub(toBN("10")), toBN("11"))));

    // Underflow.
    assert(await didContractThrow(fixedPoint.wrapAdd(int_min.add(toBN("10")), toBN("-11"))));

    // Reverts if uint (second argument) can't be represented as an Signed.
    const tenToFiftyNine = toBN("10").pow(toBN("59"));
    assert(await didContractThrow(fixedPoint.wrapMixedAdd("0", tenToFiftyNine)));

    // Reverts on underflow.
    assert(await didContractThrow(fixedPoint.wrapSub(int_min, "1")));

    // Reverts if uint (second argument) can't be represented as an Signed.
    assert(await didContractThrow(fixedPoint.wrapMixedSub(int_max, tenToFiftyNine)));

    // Reverts on underflow (i.e., result goes below int_min).
    assert(await didContractThrow(fixedPoint.wrapMixedSub(int_min, "2")));

    // Reverts on underflow (i.e., result goes below int_min).
    assert(await didContractThrow(fixedPoint.wrapMixedSubOpposite("2", int_min.add(toBN(toWei("1"))))));
  });

  it("Multipication/Division Overflow/Underflow", async function() {
    const fixedPoint = await SignedFixedPointTest.new();

    // Reverts on overflow.
    // (uint_max - 1) * 2 overflows.
    assert(await didContractThrow(fixedPoint.wrapMul(int_max.sub(toBN("1")), toWei("2"))));
    assert(await didContractThrow(fixedPoint.wrapMul(int_min.add(toBN("1")), toWei("2"))));
    assert(await didContractThrow(fixedPoint.wrapMulAwayFromZero(int_max.sub(toBN("1")), toWei("2"))));
    assert(await didContractThrow(fixedPoint.wrapMulAwayFromZero(int_min.add(toBN("1")), toWei("2"))));

    // Reverts on overflow.
    // (uint_max / 2) * 3 overflows.
    assert(await didContractThrow(fixedPoint.wrapMixedMul(int_max.div(toBN("2")), "3")));
    assert(await didContractThrow(fixedPoint.wrapMixedMul(int_min.div(toBN("2")), "3")));
    assert(await didContractThrow(fixedPoint.wrapMixedMulAwayFromZero(int_max.div(toBN("2")), "3")));
    assert(await didContractThrow(fixedPoint.wrapMixedMulAwayFromZero(int_min.div(toBN("2")), "3")));

    // Reverts on division by zero.
    assert(await didContractThrow(fixedPoint.wrapDiv("1", "0")));
    assert(await didContractThrow(fixedPoint.wrapMixedDiv("1", "0")));
    assert(await didContractThrow(fixedPoint.wrapMixedDivOpposite("1", "0")));
    assert(await didContractThrow(fixedPoint.wrapDiv("-1", "0")));
    assert(await didContractThrow(fixedPoint.wrapMixedDiv("-1", "0")));
    assert(await didContractThrow(fixedPoint.wrapMixedDivOpposite("-1", "0")));
    assert(await didContractThrow(fixedPoint.wrapDivAwayFromZero("-1", "0")));
    assert(await didContractThrow(fixedPoint.wrapMixedDivAwayFromZero("-1", "0")));

    // Large denominator works in normal div but fails in divAwayFromZero due to cast to Signed.
    const bigDenominator = toBN("10").pow(toBN("75"));
    let quotient = await fixedPoint.wrapMixedDiv(toWei("1"), bigDenominator);
    assert.equal(quotient.toString(), "0");
    assert(await didContractThrow(fixedPoint.wrapMixedDivAwayFromZero(toWei("1"), bigDenominator)));
  });

  it("Multiplication towards zero", async function() {
    const fixedPoint = await SignedFixedPointTest.new();

    // Positives
    // Fractions, no precision loss.
    let product = await fixedPoint.wrapMul(toWei("0.0001"), toWei("5"));
    assert.equal(product.toString(), toWei("0.0005"));

    // Fractions, precision loss, rounding down.
    // 1.2 * 2e-18 = 2.4e-18, which can't be represented and gets rounded towards zero to 2.
    product = await fixedPoint.wrapMul(toWei("1.2"), "2");
    assert.equal(product.toString(), "2");
    // 1e-18 * 1e-18 = 1e-36, which can't be represented and gets rounded towards zero to 0.
    product = await fixedPoint.wrapMul("1", "1");
    assert.equal(product.toString(), "0");

    // Negatives
    // Fractions, no precision loss.
    product = await fixedPoint.wrapMul(toWei("0.0001"), toWei("-5"));
    assert.equal(product.toString(), toWei("-0.0005"));

    // Fractions, precision loss, rounding down.
    // +-1.2 * +-2e-18 = -2.4e-18, which can't be represented and gets rounded towards zero to -2.
    product = await fixedPoint.wrapMul(toWei("-1.2"), "2");
    assert.equal(product.toString(), "-2");
    product = await fixedPoint.wrapMul(toWei("1.2"), "-2");
    assert.equal(product.toString(), "-2");

    // +-1e-18 * +-1e-18 = -1e-36, which can't be represented and gets rounded towards zero to 0.
    product = await fixedPoint.wrapMul("1", "-1");
    assert.equal(product.toString(), "0");
    product = await fixedPoint.wrapMul("-1", "1");
    assert.equal(product.toString(), "0");
  });

  it("Multiplication, away from zero", async function() {
    const fixedPoint = await SignedFixedPointTest.new();

    // Positives
    // Whole numbers above 10**18.
    let product = await fixedPoint.wrapMulAwayFromZero(toWei("5"), toWei("17"));
    assert.equal(product.toString(), toWei("85"));

    // Fractions, no precision loss.
    product = await fixedPoint.wrapMulAwayFromZero(toWei("0.0001"), toWei("5"));
    assert.equal(product.toString(), toWei("0.0005"));

    // Fractions, precision loss, ceiling.
    // 1.2 * 2e-18 = 2.4e-18, which can't be represented and gets rounded away from zero to 3.
    product = await fixedPoint.wrapMulAwayFromZero(toWei("1.2"), "2");
    assert.equal(product.toString(), "3");
    // 1e-18 * 1e-18 = 1e-36, which can't be represented and gets rounded away from zero to 1e-18.
    product = await fixedPoint.wrapMulAwayFromZero("1", "1");
    assert.equal(product.toString(), "1");

    // Negatives
    product = await fixedPoint.wrapMulAwayFromZero(toWei("5"), toWei("-17"));
    assert.equal(product.toString(), toWei("-85"));

    // Fractions, no precision loss.
    product = await fixedPoint.wrapMulAwayFromZero(toWei("-0.0001"), toWei("5"));
    assert.equal(product.toString(), toWei("-0.0005"));

    // Fractions, precision loss, ceiling.
    // +-1.2 * +-2e-18 = -2.4e-18, which can't be represented and gets rounded away from zero to -3.
    product = await fixedPoint.wrapMulAwayFromZero(toWei("-1.2"), "2");
    assert.equal(product.toString(), "-3");
    product = await fixedPoint.wrapMulAwayFromZero(toWei("1.2"), "-2");
    assert.equal(product.toString(), "-3");

    // +-1e-18 * +-1e-18 = -1e-36, which can't be represented and gets rounded away from zero to -1e-18.
    product = await fixedPoint.wrapMulAwayFromZero("-1", "1");
    assert.equal(product.toString(), "-1");
    product = await fixedPoint.wrapMulAwayFromZero("1", "-1");
    assert.equal(product.toString(), "-1");
  });

  it("Division", async function() {
    const fixedPoint = await SignedFixedPointTest.new();

    // Positives
    // Fractions, precision loss, rounding down.
    // 1 / 3 = 0.3 repeating, which can't be represented and gets rounded down to 0.333333333333333333.
    let quotient = await fixedPoint.wrapDiv(toWei("1"), toWei("3"));
    assert.equal(quotient.toString(), "3".repeat(18));
    // 1e-18 / 1e19 = 1e-37, which can't be represented and gets floor'd to 0.
    quotient = await fixedPoint.wrapDiv("1", toWei(toWei("10")));
    assert.equal(quotient.toString(), "0");

    // Negatives
    // Fractions, precision loss, rounding down.
    // +-1 / +-3 = -0.3 repeating, which can't be represented and gets rounded down to 0.333333333333333333.
    quotient = await fixedPoint.wrapDiv(toWei("-1"), toWei("3"));
    assert.equal(quotient.toString(), "-" + "3".repeat(18));
    quotient = await fixedPoint.wrapDiv(toWei("1"), toWei("-3"));
    assert.equal(quotient.toString(), "-" + "3".repeat(18));

    // +-1e-18 / +-1e19 = -1e-37, which can't be represented and gets floor'd to 0.
    quotient = await fixedPoint.wrapDiv("-1", toWei(toWei("10")));
    assert.equal(quotient.toString(), "0");
    quotient = await fixedPoint.wrapDiv("1", toBN(toWei(toWei("-10"))));
    assert.equal(quotient.toString(), "0");
  });

  it("Division, with ceil", async function() {
    const fixedPoint = await SignedFixedPointTest.new();

    // Positives
    // Fractions, precision loss, rounding away from zero.
    // 1 / 3 = 0.3 repeating, which can't be represented and gets rounded up to 0.333333333333333334.
    let quotient = await fixedPoint.wrapDivAwayFromZero(toWei("1"), toWei("3"));
    assert.equal(quotient.toString(), "3".repeat(17) + "4");
    // 1e-18 / 1e19 = 1e-37, which can't be represented and gets rounded away from zero to 1.
    quotient = await fixedPoint.wrapDivAwayFromZero("1", toWei(toWei("10")));
    assert.equal(quotient.toString(), "1");

    // Negatives
    // Fractions, precision loss, rounding away from zero..
    // +-1 / +-3 = -0.3 repeating, which can't be represented and gets rounded away from zero to -0.333333333333333334.
    quotient = await fixedPoint.wrapDivAwayFromZero(toWei("-1"), toWei("3"));
    assert.equal(quotient.toString(), "-" + "3".repeat(17) + "4");
    quotient = await fixedPoint.wrapDivAwayFromZero(toWei("1"), toWei("-3"));
    assert.equal(quotient.toString(), "-" + "3".repeat(17) + "4");

    // +-1e-18 / +-1e19 = -1e-37, which can't be represented and gets rounded away from zero to -1.
    quotient = await fixedPoint.wrapDivAwayFromZero("-1", toWei(toWei("10")));
    assert.equal(quotient.toString(), "-1");
    quotient = await fixedPoint.wrapDivAwayFromZero("1", toBN(toWei(toWei("-10"))));
    assert.equal(quotient.toString(), "-1");
  });

  it("Power", async function() {
    const fixedPoint = await SignedFixedPointTest.new();

    // Positives
    // 1.5^0 = 1
    assert.equal(await fixedPoint.wrapPow(toWei("1.5"), "0"), toWei("1"));

    // 1.5^1 = 1.5
    assert.equal(await fixedPoint.wrapPow(toWei("1.5"), "1"), toWei("1.5"));

    // 1.5^2 = 2.25.
    assert.equal(await fixedPoint.wrapPow(toWei("1.5"), "2"), toWei("2.25"));

    // 1.5^3 = 3.375
    assert.equal(await fixedPoint.wrapPow(toWei("1.5"), "3"), toWei("3.375"));

    // Reverts on overflow
    assert(await didContractThrow(fixedPoint.wrapPow(toWei("10"), "59")));

    // Negatives
    // -1.5^0 = 1
    assert.equal(await fixedPoint.wrapPow(toWei("-1.5"), "0"), toWei("1"));

    // -1.5^1 = -1.5
    assert.equal(await fixedPoint.wrapPow(toWei("-1.5"), "1"), toWei("-1.5"));

    // -1.5^2 = 2.25.
    assert.equal(await fixedPoint.wrapPow(toWei("-1.5"), "2"), toWei("2.25"));

    // -1.5^3 = -3.375
    assert.equal(await fixedPoint.wrapPow(toWei("-1.5"), "3"), toWei("-3.375"));

    // Reverts on overflow
    assert(await didContractThrow(fixedPoint.wrapPow(toWei("-10"), "59")));
  });
});
