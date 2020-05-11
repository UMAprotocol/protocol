const { toWei, utf8ToHex, hexToUtf8, toBN } = web3.utils;
const { didContractThrow } = require("../../../../common/SolidityTestUtils.js");
const truffleAssert = require("truffle-assertions");
const { RegistryRolesEnum } = require("../../../../common/Enums.js");
const { interfaceName } = require("../../../utils/Constants.js");

// Tested Contract
const DepositBox = artifacts.require("DepositBox");

// Helper Contracts
const Token = artifacts.require("ExpandedERC20");
const Registry = artifacts.require("Registry");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Timer = artifacts.require("Timer");
const Finder = artifacts.require("Finder");
const MockOracle = artifacts.require("MockOracle");
const Store = artifacts.require("Store");

contract("DepositBox", function(accounts) {
  let contractCreator = accounts[0];
  let user = accounts[1];
  let otherUser = accounts[2];

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

  beforeEach(async function() {
    // Collateral token to be deposited in DepositBox.
    collateralToken = await Token.new("ETH", "ETH", 18, { from: contractCreator });

    // Whitelist price feed identifier.
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier, {
      from: contractCreator
    });

    timer = await Timer.deployed();
    store = await Store.deployed();

    // Create a mockOracle and register it with the finder. We use the MockOracle so that we can manually
    // modify timestamps and push prices for demonstration purposes.
    finder = await Finder.deployed();
    mockOracle = await MockOracle.new(finder.address, timer.address, {
      from: contractCreator
    });
    const mockOracleInterfaceName = web3.utils.utf8ToHex(interfaceName.Oracle);
    await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address, { from: contractCreator });

    // Deploy a new DepositBox contract that will connect to the mockOracle for price requests.
    registry = await Registry.deployed();
    depositBox = await DepositBox.new(collateralToken.address, finder.address, priceFeedIdentifier, Timer.address);

    // Note: Upon calling `initialize()`, the DepositBox will attempt to register itself with the Registry in order to make price requests in production environments,
    // but the MockOracle in test environments does not require contracts to be registered in order to make price requests.
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, depositBox.address, {
      from: contractCreator
    });
    await depositBox.initialize();

    // Mint the user some ERC20 to begin the test.
    await collateralToken.addMember(1, contractCreator, { from: contractCreator });
    await collateralToken.mint(user, toWei("1000"), { from: contractCreator });
    await collateralToken.approve(depositBox.address, toWei("1000"), { from: user });
  });

  it("Creation correctly registers DepositBox within the registry", async function() {
    assert.isTrue(await registry.isContractRegistered(depositBox.address));
  });

  describe("Typical deposit and withdraw user flow", function() {
    const amountToDeposit = toWei("5"); // i.e. deposit 5 ETH
    const amountToWithdraw = toWei("150"); // i.e. withdraw $150 in ETH.
    const amountToOverdraw = toWei("2000"); // i.e. withdraw $2000 in ETH, which is 10 ETH at $225 exchange rate
    const exchangeRate = toWei("200"); // i.e. 1 ETH/USD = $225

    beforeEach(async function() {
      // Set regular and final fee.

      // Regular fee is charged on % of collateral locked in deposit box per second.
      // Set regular fees to unrealistcally high (but convenient for testing) 1% per second.
      await store.setFixedOracleFeePerSecondPerPfc({ rawValue: toWei("0.01") });

      // Final fees are fixed charges per price request.
      // Set this to 1 token per call.
      await store.setFinalFee(collateralToken.address, { rawValue: toWei("1") });
    });

    it("Deposit ERC20", async function() {
      const userStartingBalance = await collateralToken.balanceOf(user);

      // Submit the deposit.
      let txn = await depositBox.deposit({ rawValue: amountToDeposit }, { from: user });
      truffleAssert.eventEmitted(txn, "Deposit", ev => {
        return ev.user == user && ev.collateralAmount == amountToDeposit.toString();
      });
      truffleAssert.eventEmitted(txn, "NewDepositBox", ev => {
        return ev.user == user;
      });

      // Check balances after the deposit. 0 fees should have been charged
      // since the contract has not advanced any time.
      const userEndingBalance = await collateralToken.balanceOf(user);
      assert.equal(
        userEndingBalance.toString(),
        toBN(userStartingBalance)
          .sub(toBN(amountToDeposit))
          .toString()
      );
      assert.equal((await depositBox.getCollateral(user)).toString(), amountToDeposit.toString());
      assert.equal((await depositBox.totalDepositBoxCollateral()).toString(), amountToDeposit.toString());
      assert.equal((await depositBox.pfc()).toString(), amountToDeposit.toString());

      // Cannot submit a deposit for 0 collateral.
      assert(await didContractThrow(depositBox.deposit({ rawValue: "0" }, { from: user })));

      // Can submit a subsequent deposit.
      txn = await depositBox.deposit({ rawValue: amountToDeposit }, { from: user });
      truffleAssert.eventNotEmitted(txn, "NewDepositBox");
      assert.equal(
        (await depositBox.getCollateral(user)).toString(),
        toBN(amountToDeposit)
          .mul(toBN(2))
          .toString()
      );
      assert.equal(
        (await depositBox.totalDepositBoxCollateral()).toString(),
        toBN(amountToDeposit)
          .mul(toBN(2))
          .toString()
      );
    });

    it("Request withdrawal for ERC20 denominated in USD", async function() {
      // Deposit funds.
      await depositBox.deposit({ rawValue: amountToDeposit }, { from: user });

      // Submit the withdrawal request.
      const requestTimestamp = await depositBox.getCurrentTime();
      let txn = await depositBox.requestWithdrawal({ rawValue: amountToWithdraw }, { from: user });
      truffleAssert.eventEmitted(txn, "RequestWithdrawal", ev => {
        return (
          ev.user == user &&
          ev.collateralAmount == amountToWithdraw.toString() &&
          ev.requestPassTimestamp == requestTimestamp.toNumber()
        );
      });

      // Oracle should have an enqueued price after calling dispute.
      const pendingRequests = await mockOracle.getPendingQueries();
      assert.equal(hexToUtf8(pendingRequests[0]["identifier"]), hexToUtf8(priceFeedIdentifier));
      assert.equal(pendingRequests[0].time, requestTimestamp.toNumber());

      // A final fee should have been charged on the collateral which should get deducted from the user balances.
      assert.equal(
        (await depositBox.getCollateral(user)).toString(),
        toBN(amountToDeposit)
          .sub(toBN(toWei("1")))
          .toString()
      );
      assert.equal(
        (await depositBox.totalDepositBoxCollateral()).toString(),
        toBN(amountToDeposit)
          .sub(toBN(toWei("1")))
          .toString()
      );
      assert.equal(
        (await depositBox.pfc()).toString(),
        toBN(amountToDeposit)
          .sub(toBN(toWei("1")))
          .toString()
      );
      assert.equal((await collateralToken.balanceOf(store.address)).toString(), toWei("1").toString());

      // Can only request one withdrawal at a time.
      assert(await didContractThrow(depositBox.requestWithdrawal({ rawValue: amountToWithdraw }, { from: user })));

      // A user with a pending withdrawal can cancel the withdrawal request.
      assert(await didContractThrow(depositBox.cancelWithdrawal({ from: otherUser })));
      txn = await depositBox.cancelWithdrawal({ from: user });
      truffleAssert.eventEmitted(txn, "RequestWithdrawalCanceled", ev => {
        return (
          ev.user == user &&
          ev.collateralAmount == amountToWithdraw.toString() &&
          ev.requestPassTimestamp == requestTimestamp.toNumber()
        );
      });
      assert(await didContractThrow(depositBox.cancelWithdrawal({ from: user })));

      // Cannot submit a withdrawal for 0 collateral.
      assert(await didContractThrow(depositBox.requestWithdrawal({ rawValue: "0" }, { from: user })));

      // User can submit another withdrawal request.
      await depositBox.requestWithdrawal({ rawValue: amountToWithdraw }, { from: user });
    });

    it("Execute withdrawal after price resolves for less than full balance", async function() {
      // Deposit funds and submit withdrawal request.
      await depositBox.deposit({ rawValue: amountToDeposit }, { from: user });
      const requestTimestamp = await depositBox.getCurrentTime();
      await depositBox.requestWithdrawal({ rawValue: amountToWithdraw }, { from: user });
      const userStartingBalance = await collateralToken.balanceOf(user);

      // Cannot execute the withdrawal until a price resolves.
      assert(await didContractThrow(depositBox.executeWithdrawal({ from: user })));

      // Manually push a price to the DVM.
      await mockOracle.pushPrice(priceFeedIdentifier, requestTimestamp.toNumber(), exchangeRate);

      // Advance time forward by one second to simulate regular fees being charged.
      await depositBox.setCurrentTime(requestTimestamp.addn(1));

      // Cannot execute the withdrawal if there is no pending withdrawal for the user.
      assert(await didContractThrow(depositBox.executeWithdrawal({ from: otherUser })));

      // Execute the withdrawal request, which should withdraw (150/200 = 0.75) tokens.
      let txn = await depositBox.executeWithdrawal({ from: user });
      truffleAssert.eventEmitted(txn, "RequestWithdrawalExecuted", ev => {
        return (
          ev.user == user &&
          ev.collateralAmount == toWei("0.75").toString() &&
          ev.requestPassTimestamp == requestTimestamp.toNumber() &&
          ev.exchangeRate == exchangeRate.toString()
        );
      });

      // The user's balance should be deducted by the final fee + withdrawal amount + regular fee:
      // - final fee = 1
      // - withdrawal amount = (150/200) = 0.75
      // - regular fee = 1 second * 0.01 * (PfC - final fee) = 1 * 0.01 * 4 = 0.04
      // --> Total balance = (5 - 1 - 0.75 - 0.04) = 3.21
      assert.equal((await depositBox.getCollateral(user)).toString(), toWei("3.21").toString());
      assert.equal((await depositBox.totalDepositBoxCollateral()).toString(), toWei("3.21").toString());
      assert.equal((await depositBox.pfc()).toString(), toWei("3.21").toString());
      assert.equal((await collateralToken.balanceOf(store.address)).toString(), toWei("1.04").toString());
      const userEndingBalance = await collateralToken.balanceOf(user);
      assert.equal(
        toBN(userEndingBalance)
          .sub(toBN(userStartingBalance))
          .toString(),
        toWei("0.75").toString()
      );

      // User can submit another withdrawal request.
      await depositBox.requestWithdrawal({ rawValue: amountToWithdraw }, { from: user });
    });

    it("Execute withdrawal after price resolves for more than full balance", async function() {
      // Deposit funds and submit withdrawal request.
      await depositBox.deposit({ rawValue: amountToDeposit }, { from: user });
      const requestTimestamp = await depositBox.getCurrentTime();
      await depositBox.requestWithdrawal({ rawValue: amountToOverdraw }, { from: user });
      const userStartingBalance = await collateralToken.balanceOf(user);

      // Manually push a price to the DVM.
      await mockOracle.pushPrice(priceFeedIdentifier, requestTimestamp.toNumber(), exchangeRate);

      // Execute the withdrawal request, which should withdraw the user's full balance and delete the deposit box.
      // The user has 4 collateral remaining after the final fee.
      let txn = await depositBox.executeWithdrawal({ from: user });
      truffleAssert.eventEmitted(txn, "RequestWithdrawalExecuted", ev => {
        return (
          ev.user == user &&
          ev.collateralAmount == toWei("4").toString() &&
          ev.requestPassTimestamp == requestTimestamp.toNumber() &&
          ev.exchangeRate == exchangeRate.toString()
        );
      });
      truffleAssert.eventEmitted(txn, "EndedDepositBox", ev => {
        return ev.user == user;
      });

      // The deposit box balances should be 0.
      assert.equal((await depositBox.getCollateral(user)).toString(), "0");
      assert.equal((await depositBox.totalDepositBoxCollateral()).toString(), "0");
      assert.equal((await depositBox.pfc()).toString(), "0");
      const userEndingBalance = await collateralToken.balanceOf(user);
      assert.equal(
        toBN(userEndingBalance)
          .sub(toBN(userStartingBalance))
          .toString(),
        toWei("4").toString()
      );

      // User cannot submit a withdrawal request because they don't have enough deposited to pay for a price request.
      assert(await didContractThrow(depositBox.requestWithdrawal({ rawValue: amountToWithdraw }, { from: user })));

      // When user deposits again, they will begin a new deposit box.
      txn = await depositBox.deposit({ rawValue: amountToDeposit }, { from: user });
      truffleAssert.eventEmitted(txn, "NewDepositBox", ev => {
        return ev.user == user;
      });
    });
  });
});
