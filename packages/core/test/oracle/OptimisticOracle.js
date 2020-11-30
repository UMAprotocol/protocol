const { OptimisticOracleRequestStatesEnum, didContractThrow, interfaceName } = require("@uma/common");

const { toWei, toBN, hexToUtf8 } = web3.utils;

const OptimisticOracle = artifacts.require("OptimisticOracle");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Addresswhitelist = artifacts.require("AddressWhitelist");
const Token = artifacts.require("ExpandedERC20");
const Store = artifacts.require("Store");
const MockOracle = artifacts.require("MockOracleAncillary");
const OptimisticRequesterTest = artifacts.require("OptimisticRequesterTest");

contract("OptimisticOracle", function(accounts) {
  let optimisticOracle;
  let finder;
  let timer;
  let identifierWhitelist;
  let collateralWhitelist;
  let collateral;
  let identifier;
  let store;
  let mockOracle;
  let optimisticRequester;
  let requestTime;
  let defaultExpiryTime;
  let customExpiryTime;
  let startTime;

  // Precomputed params
  const liveness = 7200; // 2 hours
  const customLiveness = 14400; // 4 hours.
  const reward = toWei("0.5");
  const finalFee = toWei("1");
  const defaultBond = finalFee;
  const totalDefaultBond = toWei("2");
  const customBond = toWei("5");
  const totalCustomBond = toWei("6");
  const correctPrice = toWei("-17");
  const incorrectPrice = toWei("10");
  const initialUserBalance = toWei("100");

  // Accounts
  const owner = accounts[0];
  const proposer = accounts[1];
  const disputer = accounts[2];
  const rando = accounts[3];

  const verifyState = async (state, ancillaryData = "0x") => {
    assert.equal(
      (await optimisticOracle.getState(optimisticRequester.address, identifier, requestTime, ancillaryData)).toString(),
      state
    );
  };

  const verifyBalanceSum = async (address, ...balances) => {
    let sum = toBN("0");
    for (let balance of balances) {
      sum = sum.add(toBN(balance));
    }

    assert.equal((await collateral.balanceOf(address)).toString(), sum.toString());
  };

  const verifyCorrectPrice = async (ancillaryData = "0x") => {
    assert.equal(
      (await optimisticRequester.getPrice.call(identifier, requestTime, ancillaryData)).toString(),
      correctPrice
    );
  };

  const pushPrice = async price => {
    const [lastQuery] = (await mockOracle.getPendingQueries()).slice(-1);
    await mockOracle.pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price);
  };

  before(async function() {
    finder = await Finder.deployed();
    timer = await Timer.deployed();

    identifierWhitelist = await IdentifierWhitelist.deployed();
    identifier = web3.utils.utf8ToHex("Test Identifier");
    await identifierWhitelist.addSupportedIdentifier(identifier);

    collateralWhitelist = await Addresswhitelist.deployed();
    store = await Store.deployed();
  });

  beforeEach(async function() {
    collateral = await Token.new("Wrapped Ether", "WETH", 18);
    await collateral.addMember(1, owner);
    await collateral.mint(owner, initialUserBalance);
    await collateral.mint(proposer, initialUserBalance);
    await collateral.mint(disputer, initialUserBalance);
    await collateral.mint(rando, initialUserBalance);
    await collateralWhitelist.addToWhitelist(collateral.address);
    await store.setFinalFee(collateral.address, { rawValue: finalFee });

    optimisticOracle = await OptimisticOracle.new(liveness, finder.address, timer.address);

    mockOracle = await MockOracle.new(finder.address, timer.address);
    await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle), mockOracle.address);

    optimisticRequester = await OptimisticRequesterTest.new(optimisticOracle.address);

    startTime = (await optimisticOracle.getCurrentTime()).toNumber();
    requestTime = (await optimisticOracle.getCurrentTime()).toNumber() - 10;
    defaultExpiryTime = startTime + liveness;
    customExpiryTime = startTime + customLiveness;
  });

  it("Contract creation checks", async function() {
    // Liveness too large.
    assert(await didContractThrow(OptimisticOracle.new(toWei("1"), finder.address, timer.address)));

    // Liveness too small.
    assert(await didContractThrow(OptimisticOracle.new(0, finder.address, timer.address)));
  });

  it("Initial invalid state", async function() {
    await verifyState(OptimisticOracleRequestStatesEnum.INVALID);
  });

  it("No fee request", async function() {
    await optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, 0);
    await verifyState(OptimisticOracleRequestStatesEnum.REQUESTED);
  });

  it("Fees are required when specified", async function() {
    assert(
      await didContractThrow(
        optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, reward)
      )
    );
  });

  it("Fee request", async function() {
    await collateral.transfer(optimisticRequester.address, reward);
    await optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, reward);
    await verifyState(OptimisticOracleRequestStatesEnum.REQUESTED);
    await verifyBalanceSum(optimisticOracle.address, reward);
  });

  describe("Requested", function() {
    beforeEach(async function() {
      await collateral.transfer(optimisticRequester.address, reward);
      await optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, reward);
    });

    it("Default proposal", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });
      await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED);
      await verifyBalanceSum(optimisticOracle.address, reward, totalDefaultBond);
    });

    it("Custom bond proposal", async function() {
      await optimisticRequester.setBond(identifier, requestTime, "0x", customBond);
      await collateral.approve(optimisticOracle.address, totalCustomBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });
      await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED);
      await verifyBalanceSum(optimisticOracle.address, reward, totalCustomBond);
    });

    it("Propose For", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePriceFor(
        rando,
        optimisticRequester.address,
        identifier,
        requestTime,
        "0x",
        correctPrice,
        { from: proposer }
      );
      await optimisticOracle.setCurrentTime(defaultExpiryTime);
      await optimisticOracle.settle(optimisticRequester.address, identifier, requestTime, "0x");

      // Note: rando should receive a BIGGER bonus over their initial balance because the initial bond didn't come out of their wallet.
      await verifyBalanceSum(rando, initialUserBalance, totalDefaultBond, reward);
    });

    it("Custom liveness", async function() {
      await optimisticRequester.setCustomLiveness(identifier, requestTime, "0x", customLiveness);
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });

      await optimisticOracle.setCurrentTime(customExpiryTime - 1);
      await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED);
      assert(
        await didContractThrow(optimisticOracle.settle(optimisticRequester.address, identifier, requestTime, "0x"))
      );

      await optimisticOracle.setCurrentTime(customExpiryTime);
      await verifyState(OptimisticOracleRequestStatesEnum.EXPIRED);
      await optimisticOracle.settle(optimisticRequester.address, identifier, requestTime, "0x");
    });

    it("Refund", async function() {
      await optimisticRequester.setRefundOnDispute(identifier, requestTime, "0x");
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: disputer });
      await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime, "0x", {
        from: disputer
      });

      // Verify that the balance checks out and the request can settle.
      await verifyBalanceSum(optimisticRequester.address, reward);
      await pushPrice(correctPrice);
      await optimisticOracle.settle(optimisticRequester.address, identifier, requestTime, "0x");

      // Proposer should net the disputer's bond.
      await verifyBalanceSum(proposer, initialUserBalance, defaultBond);

      // Disputer should have lost their bond.
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should contain nothing.
      await verifyBalanceSum(optimisticOracle.address);

      // Store should have a final fee.
      await verifyBalanceSum(store.address, finalFee);

      // Check that the refund was included in the callback.
      assert.equal((await optimisticRequester.refund()).toString(), reward);
    });

    it("Verify dispute callback", async function() {
      await optimisticRequester.setRefundOnDispute(identifier, requestTime, "0x");
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: disputer });

      // Clear any previous callback info and call dispute.
      await optimisticRequester.clearState();
      await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime, "0x", {
        from: disputer
      });

      // Timestamp, identifier, and refund should be set.
      assert.equal(hexToUtf8(await optimisticRequester.identifier()), hexToUtf8(identifier));
      assert.equal((await optimisticRequester.timestamp()).toString(), requestTime.toString());
      assert.equal((await optimisticRequester.refund()).toString(), reward);

      // Price should be unset as this callback has not been received yet.
      assert.equal((await optimisticRequester.price()).toString(), "0");
    });
  });

  describe("Proposed correctly", function() {
    beforeEach(async function() {
      await collateral.transfer(optimisticRequester.address, reward);
      await optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, reward);
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });
    });

    it("Default liveness", async function() {
      await optimisticOracle.setCurrentTime(defaultExpiryTime);
      await verifyState(OptimisticOracleRequestStatesEnum.EXPIRED);

      // Settle contract and check results.
      await optimisticOracle.settle(optimisticRequester.address, identifier, requestTime, "0x");

      // Proposer should only net the reward.
      await verifyBalanceSum(proposer, initialUserBalance, reward);
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED);
      await verifyCorrectPrice();
    });

    it("Can't settle before default liveness", async function() {
      await optimisticOracle.setCurrentTime(defaultExpiryTime - 1);
      await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED);
      assert(
        await didContractThrow(optimisticOracle.settle(optimisticRequester.address, identifier, requestTime, "0x"))
      );
    });

    it("Verify proposal callback", async function() {
      // Only timestamp and identifier should be set.
      assert.equal(hexToUtf8(await optimisticRequester.identifier()), hexToUtf8(identifier));
      assert.equal((await optimisticRequester.timestamp()).toString(), requestTime.toString());

      // Price and refund should be unset as these callbacks have not been received yet.
      assert.equal((await optimisticRequester.price()).toString(), "0");
      assert.equal((await optimisticRequester.refund()).toString(), "0");
    });

    it("Disputed", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: disputer });
      await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime, "0x", {
        from: disputer
      });
      await verifyState(OptimisticOracleRequestStatesEnum.DISPUTED);
      await verifyBalanceSum(optimisticOracle.address, totalDefaultBond, totalDefaultBond, reward, `-${finalFee}`);

      // Push price.
      await pushPrice(correctPrice);
      await verifyState(OptimisticOracleRequestStatesEnum.RESOLVED);

      // Settle and check price and payouts.
      await optimisticRequester.getPrice(identifier, requestTime, "0x"); // Should do the same thing as settle.
      await verifyCorrectPrice();
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED);

      // Proposer should net the bond and the reward.
      await verifyBalanceSum(proposer, initialUserBalance, defaultBond, reward);

      // Disputer should have lost thier bond.
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should be empty.
      await verifyBalanceSum(optimisticOracle.address);

      // Store should have a final fee.
      await verifyBalanceSum(store.address, finalFee);
    });
  });

  describe("Proposed incorrectly", function() {
    beforeEach(async function() {
      await collateral.transfer(optimisticRequester.address, reward);
      await optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, reward);
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", incorrectPrice, {
        from: proposer
      });
    });

    it("Disputed", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: disputer });
      await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime, "0x", {
        from: disputer
      });

      // Push price.
      await pushPrice(correctPrice);
      await verifyState(OptimisticOracleRequestStatesEnum.RESOLVED);

      // Settle and check price and payouts.
      await optimisticRequester.getPrice(identifier, requestTime, "0x"); // Should do the same thing as settle.
      await verifyCorrectPrice();
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED);

      // Disputer should net the bond and the reward.
      await verifyBalanceSum(disputer, initialUserBalance, defaultBond, reward);

      // Proposer should have lost thier bond.
      await verifyBalanceSum(proposer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should be empty.
      await verifyBalanceSum(optimisticOracle.address);

      // Store should have a final fee.
      await verifyBalanceSum(store.address, finalFee);
    });

    it("Verify settlement callback", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: disputer });
      await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime, "0x", {
        from: disputer
      });

      // Clear previous callback state.
      await optimisticRequester.clearState();

      // Push price and settle.
      await pushPrice(correctPrice);
      await optimisticOracle.settle(optimisticRequester.address, identifier, requestTime, "0x");

      // Timestamp, identifier, and price should be set.
      assert.equal(hexToUtf8(await optimisticRequester.identifier()), hexToUtf8(identifier));
      assert.equal((await optimisticRequester.timestamp()).toString(), requestTime.toString());
      assert.equal((await optimisticRequester.price()).toString(), correctPrice);

      // Refund should be unset as this callback has not been received.
      assert.equal((await optimisticRequester.refund()).toString(), "0");
    });

    it("Dispute For", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: disputer });
      await optimisticOracle.disputePriceFor(rando, optimisticRequester.address, identifier, requestTime, "0x", {
        from: disputer
      });

      // Push price and settle.
      await pushPrice(correctPrice);
      await optimisticRequester.getPrice(identifier, requestTime, "0x"); // Same as settle.

      // Rando should net the bond, reward, and the full bond the disputer paid in.
      await verifyBalanceSum(rando, initialUserBalance, defaultBond, reward, totalDefaultBond);

      // Disputer should have lost their bond (since they effectively gave it to rando).
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalDefaultBond}`);

      // Proposer should have lost their bond.
      await verifyBalanceSum(proposer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should be empty.
      await verifyBalanceSum(optimisticOracle.address);

      // Store should have a final fee.
      await verifyBalanceSum(store.address, finalFee);
    });
  });

  it("Ancillary data lifecycle", async function() {
    const ancillaryData = "0x1234";

    // Initial state.
    await verifyState(OptimisticOracleRequestStatesEnum.INVALID, ancillaryData);
    assert.isNull(await optimisticRequester.ancillaryData());

    // Requested.
    await collateral.transfer(optimisticRequester.address, reward);
    await optimisticRequester.requestPrice(identifier, requestTime, ancillaryData, collateral.address, reward);
    await verifyState(OptimisticOracleRequestStatesEnum.REQUESTED, ancillaryData);

    // Proposed.
    await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
    await optimisticOracle.proposePrice(
      optimisticRequester.address,
      identifier,
      requestTime,
      ancillaryData,
      incorrectPrice,
      {
        from: proposer
      }
    );
    await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED, ancillaryData);
    assert.equal(await optimisticRequester.ancillaryData(), ancillaryData);
    await optimisticRequester.clearState();

    // Disputed.
    await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: disputer });
    await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime, ancillaryData, {
      from: disputer
    });
    await verifyState(OptimisticOracleRequestStatesEnum.DISPUTED, ancillaryData);
    assert.equal(await optimisticRequester.ancillaryData(), ancillaryData);
    await optimisticRequester.clearState();

    // Settled
    await pushPrice(correctPrice);
    await optimisticRequester.getPrice(identifier, requestTime, ancillaryData);
    await verifyState(OptimisticOracleRequestStatesEnum.SETTLED, ancillaryData);
    assert.equal(await optimisticRequester.ancillaryData(), ancillaryData);
  });
});
