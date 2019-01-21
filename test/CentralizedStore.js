
const { didContractThrow } = require("./utils/DidContractThrow.js");

const CentralizedStore = artifacts.require("CentralizedStore");

contract("CentralizedStore", function(accounts) {
  let centralizedStore;
 
  const owner = accounts[0];
  const rando = accounts[1];

  before(async function() {
    centralizedStore = await CentralizedStore.deployed();
  });

  it("Compute fees", async function() {
    // Set a convenient fee for this test case of 10%.
    await centralizedStore.setFixedFeePerSecond(web3.utils.toWei("0.1", "ether"));

    // One second time interval, 2 ether PFC. Expected fee is 0.1*2*1 = 0.2 ether.
    let fees = await centralizedStore.computeFees(100, 101, web3.utils.toWei("2", "ether"));
    assert.equal(fees.toString(), web3.utils.toWei("0.2", "ether"));

    // Ten second time interval, 2 ether PFC. Expected fee is 0.1*2*10 = 2 ether.
    fees = await centralizedStore.computeFees(100, 110, web3.utils.toWei("2", "ether"));
    assert.equal(fees.toString(), web3.utils.toWei("2", "ether"));

    // Change fee to 20%.
    await centralizedStore.setFixedFeePerSecond(web3.utils.toWei("0.2", "ether"));

    // One second time interval, 2 ether PFC. Expected fee is 0.2*2*1 = 0.4 ether.
    fees = await centralizedStore.computeFees(100, 101, web3.utils.toWei("2", "ether"));
    assert.equal(fees.toString(), web3.utils.toWei("0.4", "ether"));

    // Ten second time interval, 2 ether PFC. Expected fee is 0.2*2*10 = 4 ether.
    fees = await centralizedStore.computeFees(100, 110, web3.utils.toWei("2", "ether"));
    assert.equal(fees.toString(), web3.utils.toWei("4", "ether"));

    // Disallow endTime < startTime.
    assert(await didContractThrow(centralizedStore.computeFees(2, 1, 10)));

    // Disallow setting fees higher than 100%.
    assert(await didContractThrow(centralizedStore.setFixedFeePerSecond(web3.utils.toWei("1", "ether"))));

    // Only owner can set fees.
    assert(await didContractThrow(
        centralizedStore.setFixedFeePerSecond(web3.utils.toWei("0.1", "ether"), { from: rando })
    ));
  });

  it("Pay fees ether", async function() {
  });

  it("Pay fees ERC20", async function() {
  });

  it("Withdraw ether", async function() {
  });

  it("Withdraw ERC20", async function() {
  });
});
