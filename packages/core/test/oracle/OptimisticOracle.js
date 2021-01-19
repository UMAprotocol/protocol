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
  const halfDefaultBond = toWei("0.5"); // Default bond = final fee = 1e18.
  const defaultBond = toWei("1");
  const totalDefaultBond = toWei("2"); // Total default bond = final fee + default bond = 2e18
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
      // Handle BNs and non-BNs.
      sum = sum.add(balance.add ? balance : toBN(balance));
    }

    assert.equal((await collateral.balanceOf(address)).toString(), sum.toString());
  };

  const verifyCorrectPrice = async (ancillaryData = "0x") => {
    assert.equal(
      (await optimisticRequester.settleAndGetPrice.call(identifier, requestTime, ancillaryData)).toString(),
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

  it("Request timestamp in the future", async function() {
    const currentTime = (await optimisticOracle.getCurrentTime()).toNumber();

    // Request for current time is okay.
    await optimisticRequester.requestPrice(identifier, currentTime, "0x", collateral.address, 0);

    // 1 second in the future is not okay.
    assert(
      await didContractThrow(optimisticRequester.requestPrice(identifier, currentTime + 1, "0x", collateral.address, 0))
    );
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

  it("Bond burned when final fee == 0", async function() {
    // Set final fee and prep request.
    await store.setFinalFee(collateral.address, { rawValue: "0" });
    await collateral.transfer(optimisticRequester.address, reward);
    await optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, reward);
    // Must set the bond because it defaults to the final fee, which is 0.
    await optimisticRequester.setBond(identifier, requestTime, "0x", defaultBond);

    // Note: defaultBond does _not_ include the final fee.
    await collateral.approve(optimisticOracle.address, defaultBond, { from: proposer });
    await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
      from: proposer
    });
    await collateral.approve(optimisticOracle.address, defaultBond, { from: disputer });
    await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime, "0x", {
      from: disputer
    });

    // Settle.
    await pushPrice(correctPrice);
    await optimisticOracle.settle(optimisticRequester.address, identifier, requestTime, "0x");

    // Proposer should net half of the disputer's bond and the reward.
    await verifyBalanceSum(proposer, initialUserBalance, halfDefaultBond, reward);

    // Disputer should have lost their default bond.
    await verifyBalanceSum(disputer, initialUserBalance, `-${defaultBond}`);

    // Contract should contain nothing.
    await verifyBalanceSum(optimisticOracle.address);

    // Store should have half of the bond (the "burned" portion), but no final fee.
    await verifyBalanceSum(store.address, halfDefaultBond);
  });

  describe("hasPrice", function() {
    beforeEach(async function() {
      await collateral.transfer(optimisticRequester.address, reward);
      await optimisticRequester.requestPrice(identifier, requestTime, "0x", collateral.address, "0");
    });

    it("Should return false when no price was ever proposed", async function() {
      const result = await optimisticOracle.hasPrice(optimisticRequester.address, identifier, requestTime, "0x");
      assert.equal(result, false);
    });

    it("Should return false when price is proposed but not past liveness", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });
      const result = await optimisticOracle.hasPrice(optimisticRequester.address, identifier, requestTime, "0x");
      assert.equal(result, false);
    });

    it("Should return false when price is proposed and disputed", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });

      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: disputer });
      await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime, "0x", {
        from: disputer
      });

      const result = await optimisticOracle.hasPrice(optimisticRequester.address, identifier, requestTime, "0x");
      assert.equal(result, false);
    });

    it("Should return true when price is proposed and past liveness but not settled", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });
      await timer.setCurrentTime((await timer.getCurrentTime()).add(await optimisticOracle.defaultLiveness()));
      const result = await optimisticOracle.hasPrice(optimisticRequester.address, identifier, requestTime, "0x");
      assert.equal(result, true);
    });

    it("Should return true when price is proposed, disputed and resolved by dvm", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: disputer });
      await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime, "0x", {
        from: disputer
      });
      await pushPrice(correctPrice);
      const result = await optimisticOracle.hasPrice(optimisticRequester.address, identifier, requestTime, "0x");
      assert.equal(result, true);
    });

    it("Should return true when price is proposed, past liveness and settled", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });
      await timer.setCurrentTime((await timer.getCurrentTime()).add(await optimisticOracle.defaultLiveness()));
      await optimisticOracle.settle(optimisticRequester.address, identifier, requestTime, "0x");
      const result = await optimisticOracle.hasPrice(optimisticRequester.address, identifier, requestTime, "0x");
      assert.equal(result, true);
    });
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

    it("Burned bond rounding", async function() {
      // Set bond such that rounding will occur: 1e18 + 1.
      const bond = toBN(toWei("1")).addn(1);
      const totalBond = bond.add(toBN(finalFee));
      const halfBondCeil = bond.divn(2).addn(1);
      const halfBondFloor = bond.divn(2);

      await optimisticRequester.setBond(identifier, requestTime, "0x", bond);
      await collateral.approve(optimisticOracle.address, totalBond, { from: proposer });
      await optimisticOracle.proposePrice(optimisticRequester.address, identifier, requestTime, "0x", correctPrice, {
        from: proposer
      });

      await collateral.approve(optimisticOracle.address, totalBond, { from: disputer });
      await optimisticOracle.disputePrice(optimisticRequester.address, identifier, requestTime, "0x", {
        from: disputer
      });

      // Verify that the bonds have been paid in and the loser's bond and the final fee have been sent to the store.
      await verifyBalanceSum(
        optimisticOracle.address,
        totalBond,
        totalBond,
        reward,
        `-${halfBondFloor}`,
        `-${finalFee}`
      );
      await pushPrice(correctPrice);
      await optimisticOracle.settle(optimisticRequester.address, identifier, requestTime, "0x");

      // Proposer should net half of the disputer's bond (ceiled) and the reward.
      await verifyBalanceSum(proposer, initialUserBalance, halfBondCeil, reward);

      // Disputer should have lost their bond.
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalBond}`);

      // Contract should contain nothing.
      await verifyBalanceSum(optimisticOracle.address);

      // Store should have a final fee plus half of the bond floored (the "burned" portion).
      await verifyBalanceSum(store.address, finalFee, halfBondFloor);
    });

    it("Should Revert When Proposed For With 0 Address", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      const request = optimisticOracle.proposePriceFor(
        "0x0000000000000000000000000000000000000000",
        optimisticRequester.address,
        identifier,
        requestTime,
        "0x",
        correctPrice,
        { from: proposer }
      );
      assert(await didContractThrow(request));
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

      // Proposer should net half of the disputer's bond.
      await verifyBalanceSum(proposer, initialUserBalance, halfDefaultBond);

      // Disputer should have lost their bond.
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should contain nothing.
      await verifyBalanceSum(optimisticOracle.address);

      // Store should have a final fee plus half of the bond (the burned portion).
      await verifyBalanceSum(store.address, finalFee, halfDefaultBond);

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
      await verifyBalanceSum(
        optimisticOracle.address,
        totalDefaultBond,
        totalDefaultBond,
        reward,
        `-${finalFee}`,
        `-${halfDefaultBond}`
      );

      // Push price.
      await pushPrice(correctPrice);
      await verifyState(OptimisticOracleRequestStatesEnum.RESOLVED);

      // Settle and check price and payouts.
      await optimisticRequester.settleAndGetPrice(identifier, requestTime, "0x"); // Should do the same thing as settle.
      await verifyCorrectPrice();
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED);

      // Proposer should net half the bond and the reward.
      await verifyBalanceSum(proposer, initialUserBalance, halfDefaultBond, reward);

      // Disputer should have lost their bond.
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should be empty.
      await verifyBalanceSum(optimisticOracle.address);

      // Store should have a final fee.
      await verifyBalanceSum(store.address, finalFee, halfDefaultBond);
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
      await optimisticRequester.settleAndGetPrice(identifier, requestTime, "0x"); // Should do the same thing as settle.
      await verifyCorrectPrice();
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED);

      // Disputer should net the bond and the reward.
      await verifyBalanceSum(disputer, initialUserBalance, halfDefaultBond, reward);

      // Proposer should have lost thier bond.
      await verifyBalanceSum(proposer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should be empty.
      await verifyBalanceSum(optimisticOracle.address);

      // Store should have a final fee.
      await verifyBalanceSum(store.address, finalFee, halfDefaultBond);
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

    it("Should Revert When Dispute For With 0 Address", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: proposer });
      const request = optimisticOracle.disputePriceFor(
        "0x0000000000000000000000000000000000000000",
        optimisticRequester.address,
        identifier,
        requestTime,
        "0x",
        {
          from: disputer
        }
      );
      assert(await didContractThrow(request));
    });

    it("Dispute For", async function() {
      await collateral.approve(optimisticOracle.address, totalDefaultBond, { from: disputer });
      await optimisticOracle.disputePriceFor(rando, optimisticRequester.address, identifier, requestTime, "0x", {
        from: disputer
      });

      // Push price and settle.
      await pushPrice(correctPrice);
      await optimisticRequester.settleAndGetPrice(identifier, requestTime, "0x"); // Same as settle.

      // Rando should net half the loser's bond, reward, and the full bond the disputer paid in.
      await verifyBalanceSum(rando, initialUserBalance, halfDefaultBond, reward, totalDefaultBond);

      // Disputer should have lost their bond (since they effectively gave it to rando).
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalDefaultBond}`);

      // Proposer should have lost their bond.
      await verifyBalanceSum(proposer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should be empty.
      await verifyBalanceSum(optimisticOracle.address);

      // Store should have a final fee.
      await verifyBalanceSum(store.address, finalFee, halfDefaultBond);
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
    await optimisticRequester.settleAndGetPrice(identifier, requestTime, ancillaryData);
    await verifyState(OptimisticOracleRequestStatesEnum.SETTLED, ancillaryData);
    assert.equal(await optimisticRequester.ancillaryData(), ancillaryData);
  });

  it("Stress testing the size of ancillary data", async function() {
    const DATA_LIMIT_BYTES = 8192;
    let ancillaryData = web3.utils.randomHex(DATA_LIMIT_BYTES);

    // Initial state.
    await verifyState(OptimisticOracleRequestStatesEnum.INVALID, ancillaryData);
    assert.isNull(await optimisticRequester.ancillaryData());

    // Requested.
    await collateral.transfer(optimisticRequester.address, reward);
    // Ancillary data length must not be more than the limit.
    assert(
      await didContractThrow(
        optimisticRequester.requestPrice(
          identifier,
          requestTime,
          web3.utils.randomHex(DATA_LIMIT_BYTES + 1),
          collateral.address,
          reward
        )
      )
    );
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
    await optimisticRequester.settleAndGetPrice(identifier, requestTime, ancillaryData);
    await verifyState(OptimisticOracleRequestStatesEnum.SETTLED, ancillaryData);
    assert.equal(await optimisticRequester.ancillaryData(), ancillaryData);
  });
});
