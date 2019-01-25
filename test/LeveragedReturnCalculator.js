const { didContractThrow } = require("./utils/DidContractThrow.js");

const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const BigNumber = require("bignumber.js");

contract("LeveragedReturnCalculator", function(accounts) {
  // A deployed instance of the LeveragedReturnCalculator.
  const owner = accounts[0];

  const getReturnCalculator = async leverage => {
    return await LeveragedReturnCalculator.new(leverage, { from: owner });
  }

  it("No Leverage", async function() {
    const returnCalculator = await getReturnCalculator(1);

    // No leverage newPrice = 2*oldPrice -> return of 200%.
    const doubleReturn = await returnCalculator.computeReturn(web3.utils.toWei("0.5", "ether"), web3.utils.toWei("1", "ether"));
    assert.equal(doubleReturn.toString(), web3.utils.toWei("2", "ether"));

    // 0 newPrice should always generate a 0 return.
    const zeroReturn = await returnCalculator.computeReturn(web3.utils.toWei("1", "ether"), web3.utils.toWei("0", "ether"));
    assert.equal(zeroReturn.toString(), "0");

    // 0 oldPrice should always generate a 0 return.
    const zeroStartingPrice = await returnCalculator.computeReturn(web3.utils.toWei("0", "ether"), web3.utils.toWei("1", "ether"));
    assert.equal(zeroStartingPrice.toString(), "0");

    // Sign flip on price causes a negative return.
    const negativeReturn = await returnCalculator.computeReturn(web3.utils.toWei("1", "ether"), web3.utils.toWei("-1", "ether"));
    assert.equal(negativeReturn.toString(), web3.utils.toWei("-1", "ether"));

    // Increase in magnitude causes a positive return.
    const allNegativeInputs = await returnCalculator.computeReturn(web3.utils.toWei("-1", "ether"), web3.utils.toWei("-2", "ether"));
    assert.equal(allNegativeInputs.toString(), web3.utils.toWei("2", "ether"));
  });


});
