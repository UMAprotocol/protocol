const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

const { toBN } = web3.utils;

const Token = getContract("ExpandedERC20");
const Store = getContract("Store");
const Timer = getContract("Timer");

describe("Store", function () {
  // A deployed instance of the Store contract, ready for testing.
  let store;
  let timer;

  let accounts;
  let owner;
  let derivative;
  let erc20TokenOwner;
  let rando;

  const arbitraryTokenAddr = web3.utils.randomHex(20);

  // TODO Add test final fee for test identifier

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, derivative, erc20TokenOwner, rando] = accounts;
    await runDefaultFixture(hre);
    store = await Store.deployed();
    timer = await Timer.deployed();
  });

  it("Compute fees basic check", async function () {
    // Set fee to 10%
    let newFee = { rawValue: web3.utils.toWei("0.1", "ether") };
    await store.methods.setFixedOracleFeePerSecondPerPfc(newFee).send({ from: owner });

    let pfc = { rawValue: web3.utils.toWei("2", "ether") };

    // Wait one second, then check fees are correct
    let fees = await store.methods.computeRegularFee(100, 101, pfc).call();
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("0.2", "ether"));
    assert.equal(fees.latePenalty.toString(), "0");

    // Wait 10 seconds, then check fees are correct
    fees = await store.methods.computeRegularFee(100, 110, pfc).call();
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("2", "ether"));
  });

  it("Compute fees at 20%", async function () {
    // Change fee to 20%
    let newFee = { rawValue: web3.utils.toWei("0.2", "ether") };
    await store.methods.setFixedOracleFeePerSecondPerPfc(newFee).send({ from: owner });

    let pfc = { rawValue: web3.utils.toWei("2", "ether") };

    // Run time tests again
    let fees = await store.methods.computeRegularFee(100, 101, pfc).call();
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("0.4", "ether"));

    fees = await store.methods.computeRegularFee(100, 110, pfc).call();
    assert.equal(fees.regularFee.toString(), web3.utils.toWei("4", "ether"));
  });

  it("Check for illegal params", async function () {
    // Disallow endTime < startTime.
    assert(await didContractThrow(store.methods.computeRegularFee(2, 1, { rawValue: "10" }).call()));

    // Disallow setting fees higher than 100%.
    let highFee = { rawValue: web3.utils.toWei("1", "ether") };
    assert(await didContractThrow(store.methods.setFixedOracleFeePerSecondPerPfc(highFee).send({ from: owner })));

    // Can set weekly late fees to less than 100%.
    await store.methods
      .setWeeklyDelayFeePerSecondPerPfc({ rawValue: web3.utils.toWei("0.99", "ether") })
      .send({ from: owner });

    // Disallow setting fees >= 100%.
    assert(
      await didContractThrow(
        store.methods
          .setWeeklyDelayFeePerSecondPerPfc({ rawValue: web3.utils.toWei("1", "ether") })
          .send({ from: owner })
      )
    );

    // TODO Check that only permitted role can change the fee
  });

  it("Final fees", async function () {
    // Add final fee and confirm
    const result = await store.methods
      .setFinalFee(arbitraryTokenAddr, { rawValue: web3.utils.toWei("5", "ether") })
      .send({ from: owner });

    await assertEventEmitted(result, store, "NewFinalFee", (ev) => {
      return ev.newFinalFee.rawValue === web3.utils.toWei("5", "ether");
    });
    const fee = await store.methods.computeFinalFee(arbitraryTokenAddr).call();
    assert.equal(fee.rawValue, web3.utils.toWei("5", "ether"));
  });

  it("Weekly delay fees", async function () {
    // Add weekly delay fee and confirm
    const result = await store.methods
      .setWeeklyDelayFeePerSecondPerPfc({ rawValue: web3.utils.toWei("0.5", "ether") })
      .send({ from: owner });

    await assertEventEmitted(result, store, "NewWeeklyDelayFeePerSecondPerPfc", (ev) => {
      return ev.newWeeklyDelayFeePerSecondPerPfc.rawValue === web3.utils.toWei("0.5", "ether");
    });
  });

  it("Pay fees in Ether", async function () {
    // Verify the starting balance is 0.
    let balance = await web3.eth.getBalance(store.options.address);
    assert.equal(balance.toString(), "0");

    // Can't pay a fee of 0 ether.
    assert(
      await didContractThrow(
        store.methods.payOracleFees().send({ from: derivative, value: web3.utils.toWei("0", "ether") })
      )
    );

    // Send 1 ether to the contract and verify balance.
    await store.methods.payOracleFees().send({ from: derivative, value: web3.utils.toWei("1", "ether") });
    balance = await web3.eth.getBalance(store.options.address);
    assert.equal(balance.toString(), web3.utils.toWei("1", "ether"));

    // Send a further 2 ether to the contract and verify balance.
    await store.methods.payOracleFees().send({ from: derivative, value: web3.utils.toWei("2", "ether") });
    balance = await web3.eth.getBalance(store.options.address);
    assert.equal(balance.toString(), web3.utils.toWei("3", "ether"));

    // Only the owner can withdraw.
    assert(await didContractThrow(store.methods.withdraw(web3.utils.toWei("0.5", "ether")).send({ from: derivative })));

    // Withdraw 0.5 ether and verify the  balance.
    await store.methods.withdraw(web3.utils.toWei("0.5", "ether")).send({ from: accounts[0] });
    balance = await web3.eth.getBalance(store.options.address);
    assert.equal(balance.toString(), web3.utils.toWei("2.5", "ether"));

    // Can't withdraw more than the balance.
    assert(await didContractThrow(store.methods.withdraw(web3.utils.toWei("10", "ether")).send({ from: accounts[0] })));

    // Withdraw remaining balance.
    await store.methods.withdraw(web3.utils.toWei("2.5", "ether")).send({ from: accounts[0] });
    balance = await web3.eth.getBalance(store.options.address);
    assert.equal(balance.toString(), web3.utils.toWei("0", "ether"));
  });

  it("Pay fees in ERC20 token", async function () {
    const firstMarginToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: erc20TokenOwner });
    const secondMarginToken = await Token.new("Wrapped Ether2", "WETH2", 18).send({ from: erc20TokenOwner });

    // Mint 100 tokens of each to the contract and verify balances.
    await firstMarginToken.methods.addMember(1, erc20TokenOwner).send({ from: erc20TokenOwner });
    await firstMarginToken.methods.mint(derivative, web3.utils.toWei("100", "ether")).send({ from: erc20TokenOwner });
    let firstTokenBalanceInStore = await firstMarginToken.methods.balanceOf(store.options.address).call();
    let firstTokenBalanceInDerivative = await firstMarginToken.methods.balanceOf(derivative).call();
    assert.equal(firstTokenBalanceInStore, 0);
    assert.equal(firstTokenBalanceInDerivative, web3.utils.toWei("100", "ether"));

    await secondMarginToken.methods.addMember(1, erc20TokenOwner).send({ from: erc20TokenOwner });
    await secondMarginToken.methods.mint(derivative, web3.utils.toWei("100", "ether")).send({ from: erc20TokenOwner });
    let secondTokenBalanceInStore = await secondMarginToken.methods.balanceOf(store.options.address).call();
    let secondTokenBalanceInDerivative = await secondMarginToken.methods.balanceOf(derivative).call();
    assert.equal(secondTokenBalanceInStore, 0);
    assert.equal(secondTokenBalanceInDerivative, web3.utils.toWei("100", "ether"));

    // Pay 10 of the first margin token to the store and verify balances.
    let feeAmount = web3.utils.toWei("10", "ether");
    await firstMarginToken.methods.approve(store.options.address, feeAmount).send({ from: derivative });
    await store.methods
      .payOracleFeesErc20(firstMarginToken.options.address, { rawValue: feeAmount })
      .send({ from: derivative });
    firstTokenBalanceInStore = await firstMarginToken.methods.balanceOf(store.options.address).call();
    firstTokenBalanceInDerivative = await firstMarginToken.methods.balanceOf(derivative).call();
    assert.equal(firstTokenBalanceInStore.toString(), web3.utils.toWei("10", "ether"));
    assert.equal(firstTokenBalanceInDerivative.toString(), web3.utils.toWei("90", "ether"));

    // Pay 20 of the second margin token to the store and verify balances.
    feeAmount = web3.utils.toWei("20", "ether");
    await secondMarginToken.methods.approve(store.options.address, feeAmount).send({ from: derivative });
    await store.methods
      .payOracleFeesErc20(secondMarginToken.options.address, { rawValue: feeAmount })
      .send({ from: derivative });
    secondTokenBalanceInStore = await secondMarginToken.methods.balanceOf(store.options.address).call();
    secondTokenBalanceInDerivative = await secondMarginToken.methods.balanceOf(derivative).call();
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("20", "ether"));
    assert.equal(secondTokenBalanceInDerivative.toString(), web3.utils.toWei("80", "ether"));

    // Withdraw 15 (out of 20) of the second margin token and verify balances.
    await store.methods
      .withdrawErc20(secondMarginToken.options.address, web3.utils.toWei("15", "ether"))
      .send({ from: owner });
    let secondTokenBalanceInOwner = await secondMarginToken.methods.balanceOf(owner).call();
    secondTokenBalanceInStore = await secondMarginToken.methods.balanceOf(store.options.address).call();
    assert.equal(secondTokenBalanceInOwner.toString(), web3.utils.toWei("15", "ether"));
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("5", "ether"));

    // Only owner can withdraw.
    assert(
      await didContractThrow(
        store.methods
          .withdrawErc20(secondMarginToken.options.address, web3.utils.toWei("5", "ether"))
          .send({ from: derivative })
      )
    );

    // Can't withdraw more than the balance.
    assert(
      await didContractThrow(
        store.methods
          .withdrawErc20(secondMarginToken.options.address, web3.utils.toWei("100", "ether"))
          .send({ from: owner })
      )
    );

    // Withdraw remaining amounts and verify balancse.
    await store.methods
      .withdrawErc20(firstMarginToken.options.address, web3.utils.toWei("10", "ether"))
      .send({ from: owner });
    await store.methods
      .withdrawErc20(secondMarginToken.options.address, web3.utils.toWei("5", "ether"))
      .send({ from: owner });

    let firstTokenBalanceInOwner = await firstMarginToken.methods.balanceOf(owner).call();
    firstTokenBalanceInStore = await firstMarginToken.methods.balanceOf(store.options.address).call();
    assert.equal(firstTokenBalanceInOwner.toString(), web3.utils.toWei("10", "ether"));
    assert.equal(firstTokenBalanceInStore.toString(), web3.utils.toWei("0", "ether"));

    secondTokenBalanceInOwner = await secondMarginToken.methods.balanceOf(owner).call();
    secondTokenBalanceInStore = await secondMarginToken.methods.balanceOf(store.options.address).call();
    assert.equal(secondTokenBalanceInOwner.toString(), web3.utils.toWei("20", "ether"));
    assert.equal(secondTokenBalanceInStore.toString(), web3.utils.toWei("0", "ether"));
  });

  it("Withdraw permissions", async function () {
    const withdrawRole = "1";
    await store.methods.payOracleFees().send({ from: derivative, value: web3.utils.toWei("1", "ether") });

    // Rando cannot initially withdraw.
    assert(await didContractThrow(store.methods.withdraw(web3.utils.toWei("0.5", "ether")).send({ from: rando })));

    // Owner can delegate the withdraw permissions to rando, allowing them to withdraw.
    await store.methods.resetMember(withdrawRole, rando).send({ from: owner });
    await store.methods.withdraw(web3.utils.toWei("0.5", "ether")).send({ from: rando });

    // Owner can no longer withdraw since that permission has been moved to rando.
    assert(await didContractThrow(store.methods.withdraw(web3.utils.toWei("0.5", "ether")).send({ from: owner })));

    // Change withdraw back to owner.
    await store.methods.resetMember(withdrawRole, owner).send({ from: owner });
  });

  it("Basic late penalty", async function () {
    const lateFeeRate = web3.utils.toWei("0.0001");
    const regularFeeRate = web3.utils.toWei("0.0002");
    await store.methods.setWeeklyDelayFeePerSecondPerPfc({ rawValue: lateFeeRate }).send({ from: owner });
    await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: regularFeeRate }).send({ from: owner });

    const startTime = toBN(await store.methods.getCurrentTime().call());

    const secondsPerWeek = 604800;

    // 1 week late -> 1x lateFeeRate.
    await store.methods.setCurrentTime(startTime.addn(secondsPerWeek)).send({ from: accounts[0] });

    // The period is 100 seconds long and the pfc is 100 units of collateral. This means that the fee amount should
    // effectively be scaled by 1000.
    let { latePenalty, regularFee } = await store.methods
      .computeRegularFee(startTime, startTime.addn(100), { rawValue: web3.utils.toWei("100") })
      .call();

    // Regular fee is double the per week late fee. So after 1 week, the late fee should be 1 and the regular should be 2.
    assert.equal(latePenalty.rawValue.toString(), web3.utils.toWei("1"));
    assert.equal(regularFee.rawValue.toString(), web3.utils.toWei("2"));

    // 3 weeks late -> 3x lateFeeRate.
    await store.methods.setCurrentTime(startTime.addn(secondsPerWeek * 3)).send({ from: accounts[0] });

    ({ latePenalty, regularFee } = await store.methods
      .computeRegularFee(startTime, startTime.addn(100), { rawValue: web3.utils.toWei("100") })
      .call());

    // Regular fee is double the per week late fee. So after 3 weeks, the late fee should be 3 and the regular should be 2.
    assert.equal(latePenalty.rawValue.toString(), web3.utils.toWei("3"));
    assert.equal(regularFee.rawValue.toString(), web3.utils.toWei("2"));
  });

  it("Late penalty based on current time", async function () {
    await store.methods
      .setWeeklyDelayFeePerSecondPerPfc({ rawValue: web3.utils.toWei("0.1", "ether") })
      .send({ from: owner });

    const startTime = toBN(await store.methods.getCurrentTime().call());

    const secondsPerWeek = 604800;

    // Set current time to 1 week in the future to ensure the fee gets charged.
    await store.methods
      .setCurrentTime(toBN(await store.methods.getCurrentTime().call()).addn(secondsPerWeek))
      .send({ from: accounts[0] });

    // Pay for a short period a week ago. Even though the endTime is < 1 week past the start time, the currentTime
    // should cause the late fee to be charged.
    const { latePenalty } = await store.methods
      .computeRegularFee(startTime, startTime.addn(1), { rawValue: web3.utils.toWei("1") })
      .call();

    // Payment is 1 week late, but the penalty is 10% per second of the period. Since the period is only 1 second, {     // we should see a 10% late fee.
    assert.equal(latePenalty.rawValue, web3.utils.toWei("0.1"));
  });

  it("Constructor checks", async function () {
    const highFee = { rawValue: web3.utils.toWei("1.1", "ether") };
    const normalFee = { rawValue: web3.utils.toWei("0.1", "ether") };

    // Regular fee cannot be set above 1.
    assert(await didContractThrow(Store.new(highFee, normalFee, timer.options.address).send({ from: rando })));

    // Late fee cannot be set above 1.
    assert(await didContractThrow(Store.new(normalFee, highFee, timer.options.address).send({ from: rando })));
  });

  it("Initialization", async function () {
    const regularFee = { rawValue: web3.utils.toWei("0.2", "ether") };
    const lateFee = { rawValue: web3.utils.toWei("0.1", "ether") };

    const newStore = await Store.new(regularFee, lateFee, timer.options.address).send({ from: rando });

    // Fees should be set as they were initialized.
    assert.equal(
      (await newStore.methods.fixedOracleFeePerSecondPerPfc().call()).toString(),
      regularFee.rawValue.toString()
    );
    assert.equal(
      (await newStore.methods.weeklyDelayFeePerSecondPerPfc().call()).toString(),
      lateFee.rawValue.toString()
    );

    // rando should hold both the owner and withdrawer roles.
    assert.equal(await newStore.methods.getMember(0).call(), rando);
    assert.equal(await newStore.methods.getMember(1).call(), rando);
  });
});
