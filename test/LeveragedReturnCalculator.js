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

    const doubleReturn = await returnCalculator.computeReturn(web3.utils.toWei("1", "ether"), web3.utils.toWei("2", "ether"));

    assert.equal(doubleReturn, web3.utils.toWei("2", "ether"));
  });
});
