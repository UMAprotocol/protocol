const { toWei, utf8ToHex, toBN } = web3.utils;
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

  describe("Zero regular and final fees", function() {
    const amountToDeposit = toWei("5"); // i.e. deposit 5 ETH
    const amountToWithdraw = toWei("150"); // i.e. withdraw $150 in ETH.
    const exchangeRate = toWei("225"); // i.e. 1 ETH/USD = $225

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

      // Check balances after the deposit.
      const userEndingBalance = await collateralToken.balanceOf(user);
      assert.equal(
        userEndingBalance.toString(),
        toBN(userStartingBalance)
          .sub(toBN(amountToDeposit))
          .toString()
      );
      assert.equal((await depositBox.getCollateral(user)).toString(), amountToDeposit.toString());
      assert.equal((await depositBox.totalDepositBoxCollateral()).toString(), amountToDeposit.toString());

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
      // Can only request one withdrawal at a time.
    });

    it("Cancel withdrawal", async function() {});

    it("Execute withdrawal after price resolves", async function() {});
  });

  describe("Regular fees", function() {});

  describe("Final fees", function() {});
});
