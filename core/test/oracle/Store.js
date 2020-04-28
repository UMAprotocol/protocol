const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const truffleAssert = require("truffle-assertions");

const Token = artifacts.require("ExpandedERC20");
const Store = artifacts.require("Store");
const Timer = artifacts.require("Timer");

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
    await store.setFixedOracleFeePerSecondPerPfc(newFee, { from: owner });

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
    await store.setFixedOracleFeePerSecondPerPfc(newFee, { from: owner });

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
    assert(await didContractThrow(store.setFixedOracleFeePerSecondPerPfc(highFee, { from: owner })));

    // Can set weekly late fees to less than 100%.
    await store.setWeeklyDelayFeePerSecondPerPfc({ rawValue: web3.utils.toWei("0.99", "ether") }, { from: owner });

    // Disallow setting fees >= 100%.
    assert(
      await didContractThrow(
        store.setWeeklyDelayFeePerSecondPerPfc({ rawValue: web3.utils.toWei("1", "ether") }, { from: owner })
      )
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
    const result = await store.setWeeklyDelayFeePerSecondPerPfc(
      { rawValue: web3.utils.toWei("0.5", "ether") },
      { from: owner }
    );

    truffleAssert.eventEmitted(result, "NewWeeklyDelayFeePerSecondPerPfc", ev => {
      return ev.newWeeklyDelayFeePerSecondPerPfc.rawValue === web3.utils.toWei("0.5", "ether");
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
    const firstMarginToken = await Token.new("UMA", "UMA", 18, { from: erc20TokenOwner });
    const secondMarginToken = await Token.new("UMA2", "UMA2", 18, { from: erc20TokenOwner });

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
    let feeAmount = web3.utils.toWei("10", "ether");
    await firstMarginToken.approve(store.address, feeAmount, { from: derivative });
    await store.payOracleFeesErc20(firstMarginToken.address, { rawValue: feeAmount }, { from: derivative });
    firstTokenBalanceInStore = await firstMarginToken.balanceOf(store.address);
    firstTokenBalanceInDerivative = await firstMarginToken.balanceOf(derivative);
    assert.equal(firstTokenBalanceInStore.toString(), web3.utils.toWei("10", "ether"));
    assert.equal(firstTokenBalanceInDerivative.toString(), web3.utils.toWei("90", "ether"));

    // Pay 20 of the second margin token to the store and verify balances.
    feeAmount = web3.utils.toWei("20", "ether");
    await secondMarginToken.approve(store.address, feeAmount, { from: derivative });
    await store.payOracleFeesErc20(secondMarginToken.address, { rawValue: feeAmount }, { from: derivative });
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

  it("Basic late penalty", async function() {
    const lateFeeRate = web3.utils.toWei("0.0001");
    const regularFeeRate = web3.utils.toWei("0.0002");
    await store.setWeeklyDelayFeePerSecondPerPfc({ rawValue: lateFeeRate }, { from: owner });
    await store.setFixedOracleFeePerSecondPerPfc({ rawValue: regularFeeRate }, { from: owner });

    const startTime = await store.getCurrentTime();

    const secondsPerWeek = 604800;

    // 1 week late -> 1x lateFeeRate.
    await store.setCurrentTime(startTime.addn(secondsPerWeek));

    // The period is 100 seconds long and the pfc is 100 units of collateral. This means that the fee amount should
    // effectively be scaled by 1000.
    let { latePenalty, regularFee } = await store.computeRegularFee(startTime, startTime.addn(100), {
      rawValue: web3.utils.toWei("100")
    });

    // Regular fee is double the per week late fee. So after 1 week, the late fee should be 1 and the regular should be 2.
    assert.equal(latePenalty.rawValue.toString(), web3.utils.toWei("1"));
    assert.equal(regularFee.rawValue.toString(), web3.utils.toWei("2"));

    // 3 weeks late -> 3x lateFeeRate.
    await store.setCurrentTime(startTime.addn(secondsPerWeek * 3));

    ({ latePenalty, regularFee } = await store.computeRegularFee(startTime, startTime.addn(100), {
      rawValue: web3.utils.toWei("100")
    }));

    // Regular fee is double the per week late fee. So after 3 weeks, the late fee should be 3 and the regular should be 2.
    assert.equal(latePenalty.rawValue.toString(), web3.utils.toWei("3"));
    assert.equal(regularFee.rawValue.toString(), web3.utils.toWei("2"));
  });

  it("Late penalty based on current time", async function() {
    await store.setWeeklyDelayFeePerSecondPerPfc({ rawValue: web3.utils.toWei("0.1", "ether") }, { from: owner });

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

  it("Constructor checks", async function() {
    const highFee = { rawValue: web3.utils.toWei("1.1", "ether") };
    const normalFee = { rawValue: web3.utils.toWei("0.1", "ether") };

    // Regular fee cannot be set above 1.
    assert(await didContractThrow(Store.new(highFee, normalFee, Timer.address, { from: rando })));

    // Late fee cannot be set above 1.
    assert(await didContractThrow(Store.new(normalFee, highFee, Timer.address, { from: rando })));
  });

  it("Initialization", async function() {
    const regularFee = { rawValue: web3.utils.toWei("0.2", "ether") };
    const lateFee = { rawValue: web3.utils.toWei("0.1", "ether") };

    const newStore = await Store.new(regularFee, lateFee, Timer.address, { from: rando });

    // Fees should be set as they were initialized.
    assert.equal((await newStore.fixedOracleFeePerSecondPerPfc()).toString(), regularFee.rawValue.toString());
    assert.equal((await newStore.weeklyDelayFeePerSecondPerPfc()).toString(), lateFee.rawValue.toString());

    // rando should hold both the owner and withdrawer roles.
    assert.equal(await newStore.getMember(0), rando);
    assert.equal(await newStore.getMember(1), rando);
  });
});
