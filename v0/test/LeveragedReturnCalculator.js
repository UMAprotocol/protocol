const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const { didContractThrow } = require("../../common/SolidityTestUtils.js");

contract("LeveragedReturnCalculator", function(accounts) {
  // A deployed instance of the LeveragedReturnCalculator.
  const owner = accounts[0];

  const getReturnCalculator = async leverage => {
    return await LeveragedReturnCalculator.new(leverage, { from: owner });
  };

  it("0 leverage disallowed", async function() {
    assert(await didContractThrow(getReturnCalculator(0)));
  });

  it("No Leverage", async function() {
    const returnCalculator = await getReturnCalculator(1);

    // No leverage newPrice = 2*oldPrice -> return of 100%.
    const doubleReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("0.5", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(doubleReturn.toString(), web3.utils.toWei("1", "ether"));

    // 0 newPrice should always generate a -100% return.
    const zeroReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0", "ether")
    );
    assert.equal(zeroReturn.toString(), web3.utils.toWei("-1", "ether"));

    // 0 oldPrice should always generate a 0 return.
    const zeroStartingPrice = await returnCalculator.computeReturn(
      web3.utils.toWei("0", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(zeroStartingPrice.toString(), "0");

    // Loss of 2x the value -> -200% return.
    const negativeReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("-1", "ether")
    );
    assert.equal(negativeReturn.toString(), web3.utils.toWei("-2", "ether"));

    // Decrease in value causes a negative return.
    const allNegativeInputs = await returnCalculator.computeReturn(
      web3.utils.toWei("-1", "ether"),
      web3.utils.toWei("-2", "ether")
    );
    assert.equal(allNegativeInputs.toString(), web3.utils.toWei("-1", "ether"));
  });

  it("Leverage >1", async function() {
    const returnCalculator = await getReturnCalculator(2);

    // 2x leverage newPrice = 2*oldPrice -> return of 200%.
    const doubleUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("0.5", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(doubleUnderlying.toString(), web3.utils.toWei("2", "ether"));

    // 2x leverage newPrice = (1/2)*oldPrice -> return of -100%.
    const halfUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0.5", "ether")
    );
    assert.equal(halfUnderlying.toString(), web3.utils.toWei("-1", "ether"));

    // 0 newPrice should generate a -200% return.
    const zeroReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0", "ether")
    );
    assert.equal(zeroReturn.toString(), web3.utils.toWei("-2", "ether"));

    // 0 oldPrice should always generate a 0 return.
    const zeroStartingPrice = await returnCalculator.computeReturn(
      web3.utils.toWei("0", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(zeroStartingPrice.toString(), "0");

    // Loss of 200% -> return of -400%.
    const negativeReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("-1", "ether")
    );
    assert.equal(negativeReturn.toString(), web3.utils.toWei("-4", "ether"));

    // Decrease in value causes a 2x negative return on the difference.
    const allNegativeInputs = await returnCalculator.computeReturn(
      web3.utils.toWei("-1", "ether"),
      web3.utils.toWei("-2", "ether")
    );
    assert.equal(allNegativeInputs.toString(), web3.utils.toWei("-2", "ether"));
  });

  it("Leverage <0", async function() {
    const returnCalculator = await getReturnCalculator(-1);

    // -1x leverage newPrice = 2*oldPrice -> short return of 0%.
    const doubleUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("0.5", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(doubleUnderlying.toString(), web3.utils.toWei("-1", "ether"));

    // -1x leverage newPrice = (1/2)*oldPrice -> return of 50%.
    const halfUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0.5", "ether")
    );
    assert.equal(halfUnderlying.toString(), web3.utils.toWei("0.5", "ether"));

    // 0 newPrice should generate a 100% return.
    const zeroReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0", "ether")
    );
    assert.equal(zeroReturn.toString(), web3.utils.toWei("1", "ether"));

    // 0 oldPrice should always generate a 0 return.
    const zeroStartingPrice = await returnCalculator.computeReturn(
      web3.utils.toWei("0", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(zeroStartingPrice.toString(), "0");

    // Loss of 200% -> return of 200%.
    const negativeReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("-1", "ether")
    );
    assert.equal(negativeReturn.toString(), web3.utils.toWei("2", "ether"));

    // Decrease in value causes a positive return for a short.
    const allNegativeInputs = await returnCalculator.computeReturn(
      web3.utils.toWei("-1", "ether"),
      web3.utils.toWei("-2", "ether")
    );
    assert.equal(allNegativeInputs.toString(), web3.utils.toWei("1", "ether"));
  });

  it("Leverage <-1", async function() {
    const returnCalculator = await getReturnCalculator(-2);

    // -1x leverage newPrice = 2*oldPrice -> short return of -100%.
    const doubleUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("0.5", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(doubleUnderlying.toString(), web3.utils.toWei("-2", "ether"));

    // 2x leverage newPrice = (1/2)*oldPrice -> return of 100%.
    const halfUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0.5", "ether")
    );
    assert.equal(halfUnderlying.toString(), web3.utils.toWei("1", "ether"));

    // 0 newPrice should generate a -200% return.
    const zeroReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0", "ether")
    );
    assert.equal(zeroReturn.toString(), web3.utils.toWei("2", "ether"));

    // 0 oldPrice should always generate a 0 return.
    const zeroStartingPrice = await returnCalculator.computeReturn(
      web3.utils.toWei("0", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(zeroStartingPrice.toString(), "0");

    // Loss of 200% -> return of 400%.
    const negativeReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("-1", "ether")
    );
    assert.equal(negativeReturn.toString(), web3.utils.toWei("4", "ether"));

    // Decrease in value causes a 2x negative return for a short.
    const allNegativeInputs = await returnCalculator.computeReturn(
      web3.utils.toWei("-1", "ether"),
      web3.utils.toWei("-2", "ether")
    );
    assert.equal(allNegativeInputs.toString(), web3.utils.toWei("2", "ether"));
  });
});
