const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");

contract("LeveragedReturnCalculator", function(accounts) {
  // A deployed instance of the LeveragedReturnCalculator.
  const owner = accounts[0];

  const getReturnCalculator = async leverage => {
    return await LeveragedReturnCalculator.new(leverage, { from: owner });
  };

  it("No Leverage", async function() {
    const returnCalculator = await getReturnCalculator(1);

    // No leverage newPrice = 2*oldPrice -> return of 200%.
    const doubleReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("0.5", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(doubleReturn.toString(), web3.utils.toWei("2", "ether"));

    // 0 newPrice should always generate a 0 return.
    const zeroReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0", "ether")
    );
    assert.equal(zeroReturn.toString(), "0");

    // 0 oldPrice should always generate a 0 return.
    const zeroStartingPrice = await returnCalculator.computeReturn(
      web3.utils.toWei("0", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(zeroStartingPrice.toString(), "0");

    // Loss of 2x the value -> -100% return.
    const negativeReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("-1", "ether")
    );
    assert.equal(negativeReturn.toString(), web3.utils.toWei("-1", "ether"));

    // Decrease in value causes a negative return.
    const allNegativeInputs = await returnCalculator.computeReturn(
      web3.utils.toWei("-1", "ether"),
      web3.utils.toWei("-2", "ether")
    );
    assert.equal(allNegativeInputs.toString(), web3.utils.toWei("0", "ether"));
  });

  it("Leverage >1", async function() {
    const returnCalculator = await getReturnCalculator(2);

    // 2x leverage newPrice = 2*oldPrice -> return of 300%.
    const doubleUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("0.5", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(doubleUnderlying.toString(), web3.utils.toWei("3", "ether"));

    // 2x leverage newPrice = (1/2)*oldPrice -> return of 0%.
    const halfUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0.5", "ether")
    );
    assert.equal(halfUnderlying.toString(), "0");

    // 0 newPrice should generate a -100% return.
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

    // Loss of 200% -> return of -300%.
    const negativeReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("-1", "ether")
    );
    assert.equal(negativeReturn.toString(), web3.utils.toWei("-3", "ether"));

    // Decrease in value causes a 2x negative return on the difference.
    const allNegativeInputs = await returnCalculator.computeReturn(
      web3.utils.toWei("-1", "ether"),
      web3.utils.toWei("-2", "ether")
    );
    assert.equal(allNegativeInputs.toString(), web3.utils.toWei("-1", "ether"));
  });

  it("Leverage <0", async function() {
    const returnCalculator = await getReturnCalculator(-1);

    // -1x leverage newPrice = 2*oldPrice -> short return of 0%.
    const doubleUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("0.5", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(doubleUnderlying.toString(), web3.utils.toWei("0", "ether"));

    // -1x leverage newPrice = (1/2)*oldPrice -> return of 150%.
    const halfUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0.5", "ether")
    );
    assert.equal(halfUnderlying.toString(), web3.utils.toWei("1.5", "ether"));

    // 0 newPrice should generate a -100% return.
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

    // Loss of 200% -> return of 300%.
    const negativeReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("-1", "ether")
    );
    assert.equal(negativeReturn.toString(), web3.utils.toWei("3", "ether"));

    // Decrease in value causes a positive return for a short.
    const allNegativeInputs = await returnCalculator.computeReturn(
      web3.utils.toWei("-1", "ether"),
      web3.utils.toWei("-2", "ether")
    );
    assert.equal(allNegativeInputs.toString(), web3.utils.toWei("2", "ether"));
  });

  it("Leverage <-1", async function() {
    const returnCalculator = await getReturnCalculator(-2);

    // -1x leverage newPrice = 2*oldPrice -> short return of 0%.
    const doubleUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("0.5", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(doubleUnderlying.toString(), web3.utils.toWei("-1", "ether"));

    // 2x leverage newPrice = (1/2)*oldPrice -> return of 150%.
    const halfUnderlying = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0.5", "ether")
    );
    assert.equal(halfUnderlying.toString(), web3.utils.toWei("2", "ether"));

    // 0 newPrice should generate a -100% return.
    const zeroReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("0", "ether")
    );
    assert.equal(zeroReturn.toString(), web3.utils.toWei("3", "ether"));

    // 0 oldPrice should always generate a 0 return.
    const zeroStartingPrice = await returnCalculator.computeReturn(
      web3.utils.toWei("0", "ether"),
      web3.utils.toWei("1", "ether")
    );
    assert.equal(zeroStartingPrice.toString(), "0");

    // Loss of 200% -> return of 300%.
    const negativeReturn = await returnCalculator.computeReturn(
      web3.utils.toWei("1", "ether"),
      web3.utils.toWei("-1", "ether")
    );
    assert.equal(negativeReturn.toString(), web3.utils.toWei("5", "ether"));

    // Decrease in value causes a 2x negative return for a short.
    const allNegativeInputs = await returnCalculator.computeReturn(
      web3.utils.toWei("-1", "ether"),
      web3.utils.toWei("-2", "ether")
    );
    assert.equal(allNegativeInputs.toString(), web3.utils.toWei("3", "ether"));
  });
});
