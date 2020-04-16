const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const truffleAssert = require("truffle-assertions");

const Token = artifacts.require("ExpandedERC20");
const Store = artifacts.require("Store");

contract("Store", function(accounts) {
  // A deployed instance of the Store contract, ready for testing.
  let store;

  const owner = accounts[0];
  const derivative = accounts[1];
  const erc20TokenOwner = accounts[2];
  const rando = accounts[3];

  const identifier = web3.utils.utf8ToHex("id");
  const arbitraryTokenAddr = web3.utils.randomHex(20);

  // TODO Add test final fee for test identifier

  beforeEach(async function() {
    store = await Store.deployed();
  });

  it("Compute fees basic check", async function() {
    // Set fee to 10%
    let newFee = { rawValue: web3.utils.toWei("0.1", "ether") };
    await store.setFixedOracleFeePerSecond(newFee, { from: owner });

    let pfc = { rawValue: web3.utils.toWei("2", "ether") };

    // Wait one second, then check fees are correct
    let fees = await store.computeRegularFee(100, 101, pfc);
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("0.2", "ether"));
    assert.equal(fees.latePenalty.toString(), "0");

    // Wait 10 seconds, then check fees are correct
    fees = await store.computeRegularFee(100, 110, pfc);
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("2", "ether"));
  });

  it("Compute fees at 20%", async function() {
    // Change fee to 20%
    let newFee = { rawValue: web3.utils.toWei("0.2", "ether") };
    await store.setFixedOracleFeePerSecond(newFee, { from: owner });

    let pfc = { rawValue: web3.utils.toWei("2", "ether") };

    // Run time tests again
    let fees = await store.computeRegularFee(100, 101, pfc);
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("0.4", "ether"));

    fees = await store.computeRegularFee(100, 110, pfc);
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("4", "ether"));
  });

  it("Check for illegal params", async function() {
    // Disallow endTime < startTime.
    assert(await didContractThrow(store.computeRegularFee(2, 1, 10)));

    // Disallow setting fees higher than 100%.
    let highFee = { rawValue: web3.utils.toWei("1", "ether") };
    assert(await didContractThrow(store.setFixedOracleFeePerSecond(highFee, { from: owner })));

    // Can set weekly late fees to less than 100%.
    await store.setWeeklyDelayFee({ rawValue: web3.utils.toWei("0.99", "ether") }, { from: owner });

    // Disallow setting fees >= 100%.
    assert(
      await didContractThrow(store.setWeeklyDelayFee({ rawValue: web3.utils.toWei("1", "ether") }, { from: owner }))
    );

    // TODO Check that only permitted role can change the fee
  });

  it("Final fees", async function() {
    // Add final fee and confirm
    const result = await store.setFinalFee(
      arbitraryTokenAddr,
      { rawValue: web3.utils.toWei("5", "ether") },
      { from: owner }
    );

    truffleAssert.eventEmitted(result, "NewFinalFee", ev => {
      return ev.newFinalFee.rawValue === web3.utils.toWei("5", "ether");
    });
    const fee = await store.computeFinalFee(arbitraryTokenAddr);
    assert.equal(fee.rawValue, web3.utils.toWei("5", "ether"));
  });

  it("Weekly delay fees", async function() {
    // Add weekly delay fee and confirm
    const result = await store.setWeeklyDelayFee({ rawValue: web3.utils.toWei("0.5", "ether") }, { from: owner });

    truffleAssert.eventEmitted(result, "NewWeeklyDelayFee", ev => {
      return ev.newWeeklyDelayFee.rawValue === web3.utils.toWei("0.5", "ether");
    });
  });

  it("Pay fees in Ether", async function() {
    // Verify the starting balance is 0.
    let balance = await web3.eth.getBalance(store.address);
    assert.equal(balance.toString(), "0");

    // Can't pay a fee of 0 ether.
    assert(await didContractThrow(store.payOracleFees({ from: derivative, value: web3.utils.toWei("0", "ether") })));

    // Send 1 ether to the contract and verify balance.
    await store.payOracleFees({ from: derivative, value: web3.utils.toWei("1", "ether") });
    balance = await web3.eth.getBalance(store.address);
    assert.equal(balance.toString(), web3.utils.toWei("1", "ether"));

    // Send a further 2 ether to the contract and verify balance.
    await store.payOracleFees({ from: derivative, value: web3.utils.toWei("2", "ether") });
    balance = await web3.eth.getBalance(store.address);
    assert.equal(balance.toString(), web3.utils.toWei("3", "ether"));

    // Only the owner can withdraw.
    assert(await didContractThrow(store.withdraw(web3.utils.toWei("0.5", "ether"), { from: derivative })));

    // Withdraw 0.5 ether and verify the  balance.
    await store.withdraw(web3.utils.toWei("0.5", "ether"));
    balance = await web3.eth.getBalance(store.address);
    assert.equal(balance.toString(), web3.utils.toWei("2.5", "ether"));

    // Can't withdraw more than the balance.
    assert(await didContractThrow(store.withdraw(web3.utils.toWei("10", "ether"))));

    // Withdraw remaining balance.
    await store.withdraw(web3.utils.toWei("2.5", "ether"));
    balance = await web3.eth.getBalance(store.address);
    assert.equal(balance.toString(), web3.utils.toWei("0", "ether"));
  });

  it("Pay fees in ERC20 token", async function() {
    const firstMarginToken = await Token.new({ from: erc20TokenOwner });
    const secondMarginToken = await Token.new({ from: erc20TokenOwner });

    // Mint 100 tokens of each to the contract and verify balances.
    await firstMarginToken.addMember(1, erc20TokenOwner, { from: erc20TokenOwner });
    await firstMarginToken.mint(derivative, web3.utils.toWei("100", "ether"), { from: erc20TokenOwner });
    let firstTokenBalanceInStore = await firstMarginToken.balanceOf(store.address);
    let firstTokenBalanceInDerivative = await firstMarginToken.balanceOf(derivative);
    assert.equal(firstTokenBalanceInStore, 0);
    assert.equal(firstTokenBalanceInDerivative, web3.utils.toWei("100", "ether"));

    await secondMarginToken.addMember(1, erc20TokenOwner, { from: erc20TokenOwner });
    await secondMarginToken.mint(derivative, web3.utils.toWei("100", "ether"), { from: erc20TokenOwner });
    let secondTokenBalanceInStore = await secondMarginToken.balanceOf(store.address);
    let secondTokenBalanceInDerivative = await secondMarginToken.balanceOf(derivative);
    assert.equal(secondTokenBalanceInStore, 0);
    assert.equal(secondTokenBalanceInDerivative, web3.utils.toWei("100", "ether"));

    // Pay 10 of the first margin token to the store and verify balances.
    await firstMarginToken.approve(store.address, web3.utils.toWei("10", "ether"), { from: derivative });
    await store.payOracleFeesErc20(firstMarginToken.address, { from: derivative });
    firstTokenBalanceInStore = await firstMarginToken.balanceOf(store.address);
    firstTokenBalanceInDerivative = await firstMarginToken.balanceOf(derivative);
    assert.equal(firstTokenBalanceInStore.toString(), web3.utils.toWei("10", "ether"));
    assert.equal(firstTokenBalanceInDerivative.toString(), web3.utils.toWei("90", "ether"));

    // Pay 20 of the second margin token to the store and verify balances.
    await secondMarginToken.approve(store.address, web3.utils.toWei("20", "ether"), { from: derivative });
    await store.payOracleFeesErc20(secondMarginToken.address, { from: derivative });
    secondTokenBalanceInStore = await secondMarginToken.balanceOf(store.address);
    secondTokenBalanceInDerivative = await secondMarginToken.balanceOf(derivative);
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("20", "ether"));
    assert.equal(secondTokenBalanceInDerivative.toString(), web3.utils.toWei("80", "ether"));

    // Withdraw 15 (out of 20) of the second margin token and verify balances.
    await store.withdrawErc20(secondMarginToken.address, web3.utils.toWei("15", "ether"), { from: owner });
    let secondTokenBalanceInOwner = await secondMarginToken.balanceOf(owner);
    secondTokenBalanceInStore = await secondMarginToken.balanceOf(store.address);
    assert.equal(secondTokenBalanceInOwner.toString(), web3.utils.toWei("15", "ether"));
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("5", "ether"));

    // Only owner can withdraw.
    assert(
      await didContractThrow(
        store.withdrawErc20(secondMarginToken.address, web3.utils.toWei("5", "ether"), { from: derivative })
      )
    );

    // Can't withdraw more than the balance.
    assert(
      await didContractThrow(
        store.withdrawErc20(secondMarginToken.address, web3.utils.toWei("100", "ether"), { from: owner })
      )
    );

    // Withdraw remaining amounts and verify balancse.
    await store.withdrawErc20(firstMarginToken.address, web3.utils.toWei("10", "ether"), { from: owner });
    await store.withdrawErc20(secondMarginToken.address, web3.utils.toWei("5", "ether"), { from: owner });

    let firstTokenBalanceInOwner = await firstMarginToken.balanceOf(owner);
    firstTokenBalanceInStore = await firstMarginToken.balanceOf(store.address);
    assert.equal(firstTokenBalanceInOwner.toString(), web3.utils.toWei("10", "ether"));
    assert.equal(firstTokenBalanceInStore.toString(), web3.utils.toWei("0", "ether"));

    secondTokenBalanceInOwner = await secondMarginToken.balanceOf(owner);
    secondTokenBalanceInStore = await secondMarginToken.balanceOf(store.address);
    assert.equal(secondTokenBalanceInOwner.toString(), web3.utils.toWei("20", "ether"));
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("0", "ether"));
  });

  it("Withdraw permissions", async function() {
    const withdrawRole = "1";
    await store.payOracleFees({ from: derivative, value: web3.utils.toWei("1", "ether") });

    // Rando cannot initially withdraw.
    assert(await didContractThrow(store.withdraw(web3.utils.toWei("0.5", "ether"), { from: rando })));

    // Owner can delegate the withdraw permissions to rando, allowing them to withdraw.
    await store.resetMember(withdrawRole, rando, { from: owner });
    await store.withdraw(web3.utils.toWei("0.5", "ether"), { from: rando });

    // Owner can no longer withdraw since that permission has been moved to rando.
    assert(await didContractThrow(store.withdraw(web3.utils.toWei("0.5", "ether"), { from: owner })));

    // Change withdraw back to owner.
    await store.resetMember(withdrawRole, owner, { from: owner });
  });

  it("Late penalty based on current time", async function() {
    await store.setWeeklyDelayFee({ rawValue: web3.utils.toWei("0.1", "ether") }, { from: owner });

    const startTime = await store.getCurrentTime();

    const secondsPerWeek = 604800;

    // Set current time to 1 week in the future to ensure the fee gets charged.
    await store.setCurrentTime((await store.getCurrentTime()).addn(secondsPerWeek));

    // Pay for a short period a week ago. Even though the endTime is < 1 week past the start time, the currentTime
    // should cause the late fee to be charged.
    const { latePenalty } = await store.computeRegularFee(startTime, startTime.addn(1), {
      rawValue: web3.utils.toWei("1")
    });

    // Payment is 1 week late, but the penalty is 10% per second of the period. Since the period is only 1 second,
    // we should see a 10% late fee.
    assert.equal(latePenalty.rawValue, web3.utils.toWei("0.1"));
  });
});
