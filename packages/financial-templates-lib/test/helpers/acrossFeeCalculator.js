// The tests below validate the behaviour of the LP fee equations. We do not re-implement the equations here as
// this would not actually test anything. Rather, the equations are documented and outputs from a juypter are
// compared with as a point of reference. Moreover, we only need to validate the final calculateRealizedLpFeePct
// and can skip the underlying methods as if they contain errors so will the calculateRealizedLpFeePct method.
// The python implementation can be seen here: https://gist.github.com/chrismaree/a713725e4fe96c531c42ed7b629d4a85

const { assert } = require("chai");
const { web3 } = require("hardhat");
const { toWei, toBN } = web3.utils;
const toBNWei = (number) => toBN(toWei(number.toString()).toString());

// Function to test
const { calculateRealizedLpFeePct } = require("../../dist/helpers/acrossFeesCalculator");

// sample interest rate model. note these tests are in JS and so we can impose the RateModel type.
let rateModel = { UBar: toBNWei("0.65"), R0: toBNWei("0.00"), R1: toBNWei("0.08"), R2: toBNWei("1.00") };

describe("Realized liquidity provision calculation", function () {
  it("Realized liquidity provision calculation", async function () {
    // Define a set of intervals to test over. Each interval contains the expected rate, as generated in the juypter
    // notebook. This test, therefore, validates the python implementation matches the bots JS implementation.
    const testedIntervals = [
      { utilBefore: toBNWei("0"), utilAfter: toBNWei("0.01"), expectedRate: "615384615384600" },
      { utilBefore: toBNWei("0"), utilAfter: toBNWei("0.50"), expectedRate: "30769230769230768" },
      { utilBefore: toBNWei("0.5"), utilAfter: toBNWei("0.51"), expectedRate: "62153846153846200" },
      { utilBefore: toBNWei("0.5"), utilAfter: toBNWei("0.56"), expectedRate: "65230769230769233" },
      { utilBefore: toBNWei("0.5"), utilAfter: toBNWei("0.5").addn(100), expectedRate: "60000000000000000" },
      { utilBefore: toBNWei("0.6"), utilAfter: toBNWei("0.7"), expectedRate: "114175824175824180" },
      { utilBefore: toBNWei("0.7"), utilAfter: toBNWei("0.75"), expectedRate: "294285714285714280" },
      { utilBefore: toBNWei("0.7"), utilAfter: toBNWei("0.7").addn(100), expectedRate: "220000000000000000" },
      { utilBefore: toBNWei("0.95"), utilAfter: toBNWei("1.00"), expectedRate: "1008571428571428580" },
      { utilBefore: toBNWei("0"), utilAfter: toBNWei("0.99"), expectedRate: "220548340548340547" },
      { utilBefore: toBNWei("0"), utilAfter: toBNWei("1.00"), expectedRate: "229000000000000000" },
    ];

    testedIntervals.forEach((interval) => {
      const realizedLpFeePct = calculateRealizedLpFeePct(rateModel, interval.utilBefore, interval.utilAfter);
      assert.equal(realizedLpFeePct.toString(), interval.expectedRate);
    });
  });
});
