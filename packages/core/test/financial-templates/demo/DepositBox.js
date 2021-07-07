const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const { toWei, utf8ToHex, hexToUtf8, toBN } = web3.utils;
const { RegistryRolesEnum, didContractThrow } = require("@uma/common");
const { interfaceName } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const DepositBox = getContract("DepositBox");

// Helper Contracts
const Token = getContract("ExpandedERC20");
const Registry = getContract("Registry");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Timer = getContract("Timer");
const Finder = getContract("Finder");
const MockOracle = getContract("MockOracle");
const Store = getContract("Store");

describe("DepositBox", function () {
  let accounts;
  let contractCreator;
  let user;
  let otherUser;

  // Contract variables
  let collateralToken;
  let registry;
  let depositBox;
  let timer;
  let mockOracle;
  let finder;
  let store;

  // Constants
  const priceFeedIdentifier = utf8ToHex("ETH/USD");

  before(async function () {
    // Accounts.
    accounts = await web3.eth.getAccounts();
    [contractCreator, user, otherUser] = accounts;

    await runDefaultFixture(hre);

    // Whitelist price feed identifier.
    const identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: contractCreator });

    timer = await Timer.deployed();
    store = await Store.deployed();

    // Create a mockOracle and register it with the finder. We use the MockOracle so that we can manually
    // modify timestamps and push prices for demonstration purposes.
    finder = await Finder.deployed();
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: contractCreator });
    const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
    await finder.methods
      .changeImplementationAddress(mockOracleInterfaceName, mockOracle.options.address)
      .send({ from: contractCreator });

    // Deploy a new DepositBox contract that will connect to the mockOracle for price requests.
    registry = await Registry.deployed();
  });

  beforeEach(async function () {
    // Collateral token to be deposited in DepositBox.
    collateralToken = await Token.new("ETH", "ETH", 18).send({ from: contractCreator });

    depositBox = await DepositBox.new(
      collateralToken.options.address,
      finder.options.address,
      priceFeedIdentifier,
      timer.options.address
    ).send({ from: accounts[0] });

    // Note: Upon calling `initialize()`, the DepositBox will attempt to register itself with the Registry in order to make price requests in production environments, {     // but the MockOracle in test environments does not require contracts to be registered in order to make price requests.
    await registry.methods
      .addMember(RegistryRolesEnum.CONTRACT_CREATOR, depositBox.options.address)
      .send({ from: contractCreator });
    await depositBox.methods.initialize().send({ from: accounts[0] });

    // Mint the user some ERC20 to begin the test.
    await collateralToken.methods.addMember(1, contractCreator).send({ from: contractCreator });
    await collateralToken.methods.mint(user, toWei("1000")).send({ from: contractCreator });
    await collateralToken.methods.approve(depositBox.options.address, toWei("1000")).send({ from: user });
  });

  it("Creation correctly registers DepositBox within the registry", async function () {
    assert.isTrue(await registry.methods.isContractRegistered(depositBox.options.address).call());
  });

  describe("Typical deposit and withdraw user flow", function () {
    const amountToDeposit = toWei("5"); // i.e. deposit 5 ETH
    const amountToWithdraw = toWei("150"); // i.e. withdraw $150 in ETH.
    const amountToOverdraw = toWei("2000"); // i.e. withdraw $2000 in ETH, which is 10 ETH at $225 exchange rate
    const exchangeRate = toWei("200"); // i.e. 1 ETH/USD = $225

    beforeEach(async function () {
      // Set regular and final fee.

      // Regular fee is charged on % of collateral locked in deposit box per second.
      // Set regular fees to unrealistcally high (but convenient for testing) 1% per second.
      await store.methods.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.01") }).send({ from: accounts[0] });

      // Final fees are fixed charges per price request.
      // Set this to 1 token per call.
      await store.methods
        .setFinalFee(collateralToken.options.address, { rawValue: toWei("1") })
        .send({ from: accounts[0] });
    });

    it("Deposit ERC20", async function () {
      const userStartingBalance = await collateralToken.methods.balanceOf(user).call();

      // Submit the deposit.
      let txn = await depositBox.methods.deposit({ rawValue: amountToDeposit }).send({ from: user });
      await assertEventEmitted(txn, depositBox, "Deposit", (ev) => {
        return ev.user == user && ev.collateralAmount == amountToDeposit.toString();
      });
      await assertEventEmitted(txn, depositBox, "NewDepositBox", (ev) => {
        return ev.user == user;
      });

      // Check balances after the deposit. 0 fees should have been charged
      // since the contract has not advanced any time.
      const userEndingBalance = await collateralToken.methods.balanceOf(user).call();
      assert.equal(userEndingBalance.toString(), toBN(userStartingBalance).sub(toBN(amountToDeposit)).toString());
      assert.equal((await depositBox.methods.getCollateral(user).call()).toString(), amountToDeposit.toString());
      assert.equal(
        (await depositBox.methods.totalDepositBoxCollateral().call()).toString(),
        amountToDeposit.toString()
      );
      assert.equal((await depositBox.methods.pfc().call()).toString(), amountToDeposit.toString());

      // Cannot submit a deposit for 0 collateral.
      assert(await didContractThrow(depositBox.methods.deposit({ rawValue: "0" }).send({ from: user })));

      // Can submit a subsequent deposit.
      txn = await depositBox.methods.deposit({ rawValue: amountToDeposit }).send({ from: user });
      await assertEventNotEmitted(txn, depositBox, "NewDepositBox");
      assert.equal(
        (await depositBox.methods.getCollateral(user).call()).toString(),
        toBN(amountToDeposit).mul(toBN(2)).toString()
      );
      assert.equal(
        (await depositBox.methods.totalDepositBoxCollateral().call()).toString(),
        toBN(amountToDeposit).mul(toBN(2)).toString()
      );
    });

    it("Request withdrawal for ERC20 denominated in USD", async function () {
      // Deposit funds.
      await depositBox.methods.deposit({ rawValue: amountToDeposit }).send({ from: user });

      // Submit the withdrawal request.
      const requestTimestamp = parseInt(await depositBox.methods.getCurrentTime().call());
      let txn = await depositBox.methods.requestWithdrawal({ rawValue: amountToWithdraw }).send({ from: user });
      await assertEventEmitted(txn, depositBox, "RequestWithdrawal", (ev) => {
        return (
          ev.user == user &&
          ev.collateralAmount == amountToWithdraw.toString() &&
          ev.requestPassTimestamp == requestTimestamp
        );
      });

      // Oracle should have an enqueued price after calling dispute.
      const pendingRequests = await mockOracle.methods.getPendingQueries().call();
      assert.equal(hexToUtf8(pendingRequests[0]["identifier"]), hexToUtf8(priceFeedIdentifier));
      assert.equal(pendingRequests[0].time, requestTimestamp);

      // A final fee should have been charged on the collateral which should get deducted from the user balances.
      assert.equal(
        (await depositBox.methods.getCollateral(user).call()).toString(),
        toBN(amountToDeposit)
          .sub(toBN(toWei("1")))
          .toString()
      );
      assert.equal(
        (await depositBox.methods.totalDepositBoxCollateral().call()).toString(),
        toBN(amountToDeposit)
          .sub(toBN(toWei("1")))
          .toString()
      );
      assert.equal(
        (await depositBox.methods.pfc().call()).toString(),
        toBN(amountToDeposit)
          .sub(toBN(toWei("1")))
          .toString()
      );
      assert.equal(
        (await collateralToken.methods.balanceOf(store.options.address).call()).toString(),
        toWei("1").toString()
      );

      // Can only request one withdrawal at a time.
      assert(
        await didContractThrow(
          depositBox.methods.requestWithdrawal({ rawValue: amountToWithdraw }).send({ from: user })
        )
      );

      // A user with a pending withdrawal can cancel the withdrawal request.
      assert(await didContractThrow(depositBox.methods.cancelWithdrawal().send({ from: otherUser })));
      txn = await depositBox.methods.cancelWithdrawal().send({ from: user });
      await assertEventEmitted(txn, depositBox, "RequestWithdrawalCanceled", (ev) => {
        return (
          ev.user == user &&
          ev.collateralAmount == amountToWithdraw.toString() &&
          ev.requestPassTimestamp == requestTimestamp
        );
      });
      assert(await didContractThrow(depositBox.methods.cancelWithdrawal().send({ from: user })));

      // Cannot submit a withdrawal for 0 collateral.
      assert(await didContractThrow(depositBox.methods.requestWithdrawal({ rawValue: "0" }).send({ from: user })));

      // User can submit another withdrawal request.
      await depositBox.methods.requestWithdrawal({ rawValue: amountToWithdraw }).send({ from: user });
    });

    it("Execute withdrawal after price resolves for less than full balance", async function () {
      // Deposit funds and submit withdrawal request.
      await depositBox.methods.deposit({ rawValue: amountToDeposit }).send({ from: user });
      const requestTimestamp = parseInt(await depositBox.methods.getCurrentTime().call());
      await depositBox.methods.requestWithdrawal({ rawValue: amountToWithdraw }).send({ from: user });
      const userStartingBalance = await collateralToken.methods.balanceOf(user).call();

      // Cannot execute the withdrawal until a price resolves.
      assert(await didContractThrow(depositBox.methods.executeWithdrawal().send({ from: user })));

      // Manually push a price to the DVM.
      await mockOracle.methods
        .pushPrice(priceFeedIdentifier, requestTimestamp, exchangeRate)
        .send({ from: accounts[0] });

      // Advance time forward by one second to simulate regular fees being charged.
      await depositBox.methods.setCurrentTime(requestTimestamp + 1).send({ from: accounts[0] });

      // Cannot execute the withdrawal if there is no pending withdrawal for the user.
      assert(await didContractThrow(depositBox.methods.executeWithdrawal().send({ from: otherUser })));

      // Execute the withdrawal request, which should withdraw (150/200 = 0.75) tokens.
      let txn = await depositBox.methods.executeWithdrawal().send({ from: user });
      await assertEventEmitted(txn, depositBox, "RequestWithdrawalExecuted", (ev) => {
        return (
          ev.user == user &&
          ev.collateralAmount == toWei("0.75").toString() &&
          ev.requestPassTimestamp == requestTimestamp &&
          ev.exchangeRate == exchangeRate.toString()
        );
      });

      // The user's balance should be deducted by the final fee + withdrawal amount + regular fee:
      // - final fee = 1
      // - withdrawal amount = (150/200) = 0.75
      // - regular fee = 1 second * 0.01 * (PfC - final fee) = 1 * 0.01 * 4 = 0.04
      // --> Total balance = (5 - 1 - 0.75 - 0.04) = 3.21
      assert.equal((await depositBox.methods.getCollateral(user).call()).toString(), toWei("3.21").toString());
      assert.equal((await depositBox.methods.totalDepositBoxCollateral().call()).toString(), toWei("3.21").toString());
      assert.equal((await depositBox.methods.pfc().call()).toString(), toWei("3.21").toString());
      assert.equal(
        (await collateralToken.methods.balanceOf(store.options.address).call()).toString(),
        toWei("1.04").toString()
      );
      const userEndingBalance = await collateralToken.methods.balanceOf(user).call();
      assert.equal(toBN(userEndingBalance).sub(toBN(userStartingBalance)).toString(), toWei("0.75").toString());

      // User can submit another withdrawal request.
      await depositBox.methods.requestWithdrawal({ rawValue: amountToWithdraw }).send({ from: user });
    });

    it("Execute withdrawal after price resolves for more than full balance", async function () {
      // Deposit funds and submit withdrawal request.
      await depositBox.methods.deposit({ rawValue: amountToDeposit }).send({ from: user });
      const requestTimestamp = parseInt(await depositBox.methods.getCurrentTime().call());
      await depositBox.methods.setCurrentTime(requestTimestamp).send({ from: accounts[0] });
      await depositBox.methods.requestWithdrawal({ rawValue: amountToOverdraw }).send({ from: user });
      const userStartingBalance = await collateralToken.methods.balanceOf(user).call();

      // Manually push a price to the DVM.
      await mockOracle.methods
        .pushPrice(priceFeedIdentifier, requestTimestamp, exchangeRate)
        .send({ from: accounts[0] });

      // Execute the withdrawal request, which should withdraw the user's full balance and delete the deposit box.
      // The user has 4 collateral remaining after the final fee.
      let txn = await depositBox.methods.executeWithdrawal().send({ from: user });
      await assertEventEmitted(txn, depositBox, "RequestWithdrawalExecuted", (ev) => {
        return (
          ev.user == user &&
          ev.collateralAmount == toWei("4").toString() &&
          ev.requestPassTimestamp == requestTimestamp &&
          ev.exchangeRate == exchangeRate.toString()
        );
      });
      await assertEventEmitted(txn, depositBox, "EndedDepositBox", (ev) => {
        return ev.user == user;
      });

      // The deposit box balances should be 0.
      assert.equal((await depositBox.methods.getCollateral(user).call()).toString(), "0");
      assert.equal((await depositBox.methods.totalDepositBoxCollateral().call()).toString(), "0");
      assert.equal((await depositBox.methods.pfc().call()).toString(), "0");
      const userEndingBalance = await collateralToken.methods.balanceOf(user).call();
      assert.equal(toBN(userEndingBalance).sub(toBN(userStartingBalance)).toString(), toWei("4").toString());

      // User cannot submit a withdrawal request because they don't have enough deposited to pay for a price request.
      assert(
        await didContractThrow(
          depositBox.methods.requestWithdrawal({ rawValue: amountToWithdraw }).send({ from: user })
        )
      );

      // When user deposits again, they will begin a new deposit box.
      txn = await depositBox.methods.deposit({ rawValue: amountToDeposit }).send({ from: user });
      await assertEventEmitted(txn, depositBox, "NewDepositBox", (ev) => {
        return ev.user == user;
      });
    });
  });
});
