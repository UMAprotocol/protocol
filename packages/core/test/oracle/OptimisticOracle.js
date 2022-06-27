const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { OptimisticOracleRequestStatesEnum, didContractThrow, interfaceName } = require("@uma/common");
const { assert } = require("chai");

const { toWei, toBN, hexToUtf8, utf8ToHex } = web3.utils;
const INT_MIN = toBN("2").pow(toBN("255")).mul(toBN("-1"));

// Note: these tests are set to work on the latest version of the Optimistic oracle.
const OptimisticOracle = getContract("OptimisticOracleV2");
const Finder = getContract("Finder");
const Timer = getContract("Timer");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Addresswhitelist = getContract("AddressWhitelist");
const Token = getContract("ExpandedERC20");
const Store = getContract("Store");
const MockOracle = getContract("MockOracleAncillary");
const OptimisticRequesterTest = getContract("OptimisticRequesterTest");

describe("OptimisticOracleV2", function () {
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
  let accounts;
  let owner;
  let proposer;
  let disputer;
  let rando;

  const verifyState = async (state, ancillaryData = "0x") => {
    assert.equal(
      (
        await optimisticOracle.methods
          .getState(optimisticRequester.options.address, identifier, requestTime, ancillaryData)
          .call()
      ).toString(),
      state
    );
  };

  const verifyBalanceSum = async (address, ...balances) => {
    let sum = toBN("0");
    for (let balance of balances) {
      // Handle BNs and non-BNs.
      sum = sum.add(balance.add ? balance : toBN(balance));
    }

    assert.equal((await collateral.methods.balanceOf(address).call()).toString(), sum.toString());
  };

  const verifyCorrectPrice = async (ancillaryData = "0x") => {
    assert.equal(
      (await optimisticRequester.methods.settleAndGetPrice(identifier, requestTime, ancillaryData).call()).toString(),
      correctPrice
    );
  };

  const pushPrice = async (price) => {
    const [lastQuery] = (await mockOracle.methods.getPendingQueries().call()).slice(-1);
    await mockOracle.methods
      .pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price)
      .send({ from: accounts[0] });
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, proposer, disputer, rando] = accounts;
    await runDefaultFixture(hre);
    finder = await Finder.deployed();
    timer = await Timer.deployed();

    identifierWhitelist = await IdentifierWhitelist.deployed();
    identifier = web3.utils.utf8ToHex("Test Identifier");
    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    collateralWhitelist = await Addresswhitelist.deployed();
    store = await Store.deployed();
  });

  beforeEach(async function () {
    collateral = await Token.new("Wrapped Ether", "WETH", 18).send({ from: accounts[0] });
    await collateral.methods.addMember(1, owner).send({ from: accounts[0] });
    await collateral.methods.mint(owner, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(proposer, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(disputer, initialUserBalance).send({ from: accounts[0] });
    await collateral.methods.mint(rando, initialUserBalance).send({ from: accounts[0] });
    await collateralWhitelist.methods.addToWhitelist(collateral.options.address).send({ from: accounts[0] });
    await store.methods.setFinalFee(collateral.options.address, { rawValue: finalFee }).send({ from: accounts[0] });

    optimisticOracle = await OptimisticOracle.new(liveness, finder.options.address, timer.options.address).send({
      from: accounts[0],
    });

    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: accounts[0] });

    optimisticRequester = await OptimisticRequesterTest.new(optimisticOracle.options.address).send({
      from: accounts[0],
    });

    startTime = parseInt(await optimisticOracle.methods.getCurrentTime().call());
    requestTime = parseInt(await optimisticOracle.methods.getCurrentTime().call()) - 10;
    defaultExpiryTime = startTime + liveness;
    customExpiryTime = startTime + customLiveness;
  });

  it("Contract creation checks", async function () {
    // Liveness too large.
    assert(
      await didContractThrow(
        OptimisticOracle.new(toWei("1"), finder.options.address, timer.options.address).send({ from: accounts[0] })
      )
    );

    // Liveness too small.
    assert(
      await didContractThrow(
        OptimisticOracle.new(0, finder.options.address, timer.options.address).send({ from: accounts[0] })
      )
    );
  });

  it("Initial invalid state", async function () {
    await verifyState(OptimisticOracleRequestStatesEnum.INVALID);
  });

  it("Request timestamp in the future", async function () {
    const currentTime = parseInt(await optimisticOracle.methods.getCurrentTime().call());

    // Request for current time is okay.
    await optimisticRequester.methods
      .requestPrice(identifier, currentTime, "0x", collateral.options.address, 0)
      .send({ from: accounts[0] });

    // 1 second in the future is not okay.
    assert(
      await didContractThrow(
        optimisticRequester.methods
          .requestPrice(identifier, currentTime + 1, "0x", collateral.options.address, 0)
          .send({ from: accounts[0] })
      )
    );
  });

  it("No fee request", async function () {
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, "0x", collateral.options.address, 0)
      .send({ from: accounts[0] });
    await verifyState(OptimisticOracleRequestStatesEnum.REQUESTED);
  });

  it("Fees are required when specified", async function () {
    assert(
      await didContractThrow(
        optimisticRequester.methods
          .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward)
          .send({ from: accounts[0] })
      )
    );
  });

  it("Fee request", async function () {
    await collateral.methods.transfer(optimisticRequester.options.address, reward).send({ from: accounts[0] });
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward)
      .send({ from: accounts[0] });
    await verifyState(OptimisticOracleRequestStatesEnum.REQUESTED);
    await verifyBalanceSum(optimisticOracle.options.address, reward);
  });

  it("Bond burned when final fee == 0", async function () {
    // Set final fee and prep request.
    await store.methods.setFinalFee(collateral.options.address, { rawValue: "0" }).send({ from: accounts[0] });
    await collateral.methods.transfer(optimisticRequester.options.address, reward).send({ from: accounts[0] });
    await optimisticRequester.methods
      .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward)
      .send({ from: accounts[0] });
    // Must set the bond because it defaults to the final fee, which is 0.
    await optimisticRequester.methods.setBond(identifier, requestTime, "0x", defaultBond).send({ from: accounts[0] });

    // Note: defaultBond does _not_ include the final fee.
    await collateral.methods.approve(optimisticOracle.options.address, defaultBond).send({ from: proposer });
    await optimisticOracle.methods
      .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
      .send({ from: proposer });
    await collateral.methods.approve(optimisticOracle.options.address, defaultBond).send({ from: disputer });
    await optimisticOracle.methods
      .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
      .send({ from: disputer });

    // Settle.
    await pushPrice(correctPrice);
    await optimisticOracle.methods
      .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
      .send({ from: accounts[0] });

    // Proposer should net half of the disputer's bond and the reward.
    await verifyBalanceSum(proposer, initialUserBalance, halfDefaultBond, reward);

    // Disputer should have lost their default bond.
    await verifyBalanceSum(disputer, initialUserBalance, `-${defaultBond}`);

    // Contract should contain nothing.
    await verifyBalanceSum(optimisticOracle.options.address);

    // Store should have half of the bond (the "burned" portion), but no final fee.
    await verifyBalanceSum(store.options.address, halfDefaultBond);
  });

  describe("hasPrice", function () {
    beforeEach(async function () {
      await collateral.methods.transfer(optimisticRequester.options.address, reward).send({ from: accounts[0] });
      await optimisticRequester.methods
        .requestPrice(identifier, requestTime, "0x", collateral.options.address, "0")
        .send({ from: accounts[0] });
    });

    it("Should return false when no price was ever proposed", async function () {
      const result = await optimisticOracle.methods
        .hasPrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .call();
      assert.equal(result, false);
    });

    it("Should return false when price is proposed but not past liveness", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
      const result = await optimisticOracle.methods
        .hasPrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .call();
      assert.equal(result, false);
    });

    it("Should return false when price is proposed and disputed", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });

      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });

      const result = await optimisticOracle.methods
        .hasPrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .call();
      assert.equal(result, false);
    });

    it("Should return true when price is proposed and past liveness but not settled", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
      await timer.methods
        .setCurrentTime(
          toBN(await timer.methods.getCurrentTime().call()).add(
            toBN(await optimisticOracle.methods.defaultLiveness().call())
          )
        )
        .send({ from: accounts[0] });
      const result = await optimisticOracle.methods
        .hasPrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .call();
      assert.equal(result, true);
    });

    it("Should return true when price is proposed, disputed and resolved by dvm", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });
      await pushPrice(correctPrice);
      const result = await optimisticOracle.methods
        .hasPrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .call();
      assert.equal(result, true);
    });

    it("Should return true when price is proposed, past liveness and settled", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
      await timer.methods
        .setCurrentTime(
          toBN(await timer.methods.getCurrentTime().call()).add(
            toBN(await optimisticOracle.methods.defaultLiveness().call())
          )
        )
        .send({ from: accounts[0] });
      await optimisticOracle.methods
        .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: accounts[0] });
      const result = await optimisticOracle.methods
        .hasPrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .call();
      assert.equal(result, true);
    });
  });

  describe("Requested", function () {
    beforeEach(async function () {
      await collateral.methods.transfer(optimisticRequester.options.address, reward).send({ from: accounts[0] });
      await optimisticRequester.methods
        .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward)
        .send({ from: accounts[0] });
    });

    it("Default proposal", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
      await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED);
      await verifyBalanceSum(optimisticOracle.options.address, reward, totalDefaultBond);
    });

    it("INT_MIN proposal", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", INT_MIN)
        .send({ from: proposer });
      await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED);
      await verifyBalanceSum(optimisticOracle.options.address, reward, totalDefaultBond);
    });

    it("Custom bond proposal", async function () {
      await optimisticRequester.methods.setBond(identifier, requestTime, "0x", customBond).send({ from: accounts[0] });
      await collateral.methods.approve(optimisticOracle.options.address, totalCustomBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
      await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED);
      await verifyBalanceSum(optimisticOracle.options.address, reward, totalCustomBond);
    });

    it("Burned bond rounding", async function () {
      // Set bond such that rounding will occur: 1e18 + 1.
      const bond = toBN(toWei("1")).addn(1);
      const totalBond = bond.add(toBN(finalFee));
      const halfBondCeil = bond.divn(2).addn(1);
      const halfBondFloor = bond.divn(2);

      await optimisticRequester.methods.setBond(identifier, requestTime, "0x", bond).send({ from: accounts[0] });
      await collateral.methods.approve(optimisticOracle.options.address, totalBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });

      await collateral.methods.approve(optimisticOracle.options.address, totalBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });

      // Verify that the bonds have been paid in and the loser's bond and the final fee have been sent to the store.
      await verifyBalanceSum(
        optimisticOracle.options.address,
        totalBond,
        totalBond,
        reward,
        `-${halfBondFloor}`,
        `-${finalFee}`
      );
      await pushPrice(correctPrice);
      await optimisticOracle.methods
        .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: accounts[0] });

      // Proposer should net half of the disputer's bond (ceiled) and the reward.
      await verifyBalanceSum(proposer, initialUserBalance, halfBondCeil, reward);

      // Disputer should have lost their bond.
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalBond}`);

      // Contract should contain nothing.
      await verifyBalanceSum(optimisticOracle.options.address);

      // Store should have a final fee plus half of the bond floored (the "burned" portion).
      await verifyBalanceSum(store.options.address, finalFee, halfBondFloor);
    });

    it("Should Revert When Proposed For With 0 Address", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      const request = optimisticOracle.methods
        .proposePriceFor(
          "0x0000000000000000000000000000000000000000",
          optimisticRequester.options.address,
          identifier,
          requestTime,
          "0x",
          correctPrice
        )
        .send({ from: proposer });
      assert(await didContractThrow(request));
    });
    it("Propose For", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePriceFor(rando, optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
      await optimisticOracle.methods.setCurrentTime(defaultExpiryTime).send({ from: accounts[0] });
      await optimisticOracle.methods
        .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: accounts[0] });

      // Note: rando should receive a BIGGER bonus over their initial balance because the initial bond didn't come out of their wallet.
      await verifyBalanceSum(rando, initialUserBalance, totalDefaultBond, reward);
    });

    it("Custom liveness", async function () {
      await optimisticRequester.methods
        .setCustomLiveness(identifier, requestTime, "0x", customLiveness)
        .send({ from: accounts[0] });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });

      await optimisticOracle.methods.setCurrentTime(customExpiryTime - 1).send({ from: accounts[0] });
      await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED);
      assert(
        await didContractThrow(
          optimisticOracle.methods
            .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
            .send({ from: accounts[0] })
        )
      );

      await optimisticOracle.methods.setCurrentTime(customExpiryTime).send({ from: accounts[0] });
      await verifyState(OptimisticOracleRequestStatesEnum.EXPIRED);
      await optimisticOracle.methods
        .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: accounts[0] });
    });

    it("Refund", async function () {
      await optimisticRequester.methods.setRefundOnDispute(identifier, requestTime, "0x").send({ from: accounts[0] });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });

      // Verify that the balance checks out and the request can settle.
      await verifyBalanceSum(optimisticRequester.options.address, reward);
      await pushPrice(correctPrice);
      await optimisticOracle.methods
        .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: accounts[0] });

      // Proposer should net half of the disputer's bond.
      await verifyBalanceSum(proposer, initialUserBalance, halfDefaultBond);

      // Disputer should have lost their bond.
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should contain nothing.
      await verifyBalanceSum(optimisticOracle.options.address);

      // Store should have a final fee plus half of the bond (the burned portion).
      await verifyBalanceSum(store.options.address, finalFee, halfDefaultBond);

      // Check that the reward was refunded to the requester.
      await verifyBalanceSum(optimisticRequester.options.address, reward);
    });

    it("Event-based", async function () {
      await optimisticRequester.methods.setEventBased(identifier, requestTime, "0x").send({ from: accounts[0] });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });

      // Contract should throw if INT_MIN is proposed.
      assert(
        await didContractThrow(
          optimisticOracle.methods
            .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", INT_MIN)
            .send({ from: proposer })
        )
      );

      // Make sure the proposal time != request time.
      const requestSubmissionTimestamp = await optimisticOracle.methods.getCurrentTime().call();
      const proposalSubmissionTimestamp = parseInt(requestSubmissionTimestamp.toString()) + 100;
      await optimisticOracle.methods.setCurrentTime(proposalSubmissionTimestamp).send({ from: accounts[0] });

      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });

      const disputeSubmissionTimestamp = proposalSubmissionTimestamp + 100;
      await optimisticOracle.methods.setCurrentTime(disputeSubmissionTimestamp).send({ from: accounts[0] });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });

      // Verify that the balance checks out and the request can settle.
      await verifyBalanceSum(optimisticRequester.options.address, reward);

      // Verify that the DVM query was at the proposal time, not the request time or dispute time;
      const [lastQuery] = (await mockOracle.methods.getPendingQueries().call()).slice(-1);
      assert.equal(lastQuery.time.toString(), proposalSubmissionTimestamp.toString());
      assert.notEqual(lastQuery.time.toString(), requestSubmissionTimestamp.toString());
      assert.notEqual(lastQuery.time.toString(), requestTime.toString());
      assert.notEqual(lastQuery.time.toString(), disputeSubmissionTimestamp.toString());
      await pushPrice(correctPrice);
      await optimisticOracle.methods
        .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: accounts[0] });

      // Proposer should net half of the disputer's bond.
      await verifyBalanceSum(proposer, initialUserBalance, halfDefaultBond);

      // Disputer should have lost their bond.
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should contain nothing.
      await verifyBalanceSum(optimisticOracle.options.address);

      // Store should have a final fee plus half of the bond (the burned portion).
      await verifyBalanceSum(store.options.address, finalFee, halfDefaultBond);

      // Check that the reward was refunded to the requester.
      await verifyBalanceSum(optimisticRequester.options.address, reward);
    });

    it("Callback on priceProposed not enabled", async function () {
      // Callbacks are disabled by default, so setting callbacks to revert would not affect price proposal.
      await optimisticRequester.methods.setRevert(true).send({ from: accounts[0] });

      // Propose price.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });

      // No state variables should be set.
      assert.equal(hexToUtf8(await optimisticRequester.methods.identifier().call()), "");
      assert.equal((await optimisticRequester.methods.timestamp().call()).toString(), "0");
      assert.equal((await optimisticRequester.methods.price().call()).toString(), "0");
      assert.equal((await optimisticRequester.methods.refund().call()).toString(), "0");
    });

    it("Callback on priceProposed enabled", async function () {
      // Enable only priceProposed callback.
      const [callbackOnPriceProposed, callbackOnPriceDisputed, callbackOnPriceSettled] = [true, false, false];
      await optimisticRequester.methods
        .setCallbacks(
          identifier,
          requestTime,
          "0x",
          callbackOnPriceProposed,
          callbackOnPriceDisputed,
          callbackOnPriceSettled
        )
        .send({ from: accounts[0] });

      // Propose price.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });

      // Only timestamp and identifier should be set.
      assert.equal(hexToUtf8(await optimisticRequester.methods.identifier().call()), hexToUtf8(identifier));
      assert.equal((await optimisticRequester.methods.timestamp().call()).toString(), requestTime.toString());

      // Price and refund should be unset as these callbacks have not been received yet.
      assert.equal((await optimisticRequester.methods.price().call()).toString(), "0");
      assert.equal((await optimisticRequester.methods.refund().call()).toString(), "0");
    });

    it("Callback on priceDisputed not enabled", async function () {
      // Callbacks are disabled by default, so setting callbacks to revert would not affect price dispute.
      await optimisticRequester.methods.setRevert(true).send({ from: accounts[0] });

      // Enabling refund on dispute would have set refund state variable if callback was enabled.
      await optimisticRequester.methods.setRefundOnDispute(identifier, requestTime, "0x").send({ from: accounts[0] });

      // Propose price and dispute.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });

      // No state variables should be set.
      assert.equal(hexToUtf8(await optimisticRequester.methods.identifier().call()), "");
      assert.equal((await optimisticRequester.methods.timestamp().call()).toString(), "0");
      assert.equal((await optimisticRequester.methods.price().call()).toString(), "0");
      assert.equal((await optimisticRequester.methods.refund().call()).toString(), "0");
    });

    it("Callback on priceDisputed enabled", async function () {
      // Enable only priceDisputed callback.
      const [callbackOnPriceProposed, callbackOnPriceDisputed, callbackOnPriceSettled] = [false, true, false];
      await optimisticRequester.methods
        .setCallbacks(
          identifier,
          requestTime,
          "0x",
          callbackOnPriceProposed,
          callbackOnPriceDisputed,
          callbackOnPriceSettled
        )
        .send({ from: accounts[0] });

      // Enable refund on dispute so that it can be detected in callback.
      await optimisticRequester.methods.setRefundOnDispute(identifier, requestTime, "0x").send({ from: accounts[0] });

      // Propose price.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });

      // No state variables should be set before the dispute as priceProposed is not enabled.
      assert.equal(hexToUtf8(await optimisticRequester.methods.identifier().call()), "");
      assert.equal((await optimisticRequester.methods.timestamp().call()).toString(), "0");
      assert.equal((await optimisticRequester.methods.price().call()).toString(), "0");
      assert.equal((await optimisticRequester.methods.refund().call()).toString(), "0");

      // Dispute proposal.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });

      // Timestamp, identifier, and refund should be set.
      assert.equal(hexToUtf8(await optimisticRequester.methods.identifier().call()), hexToUtf8(identifier));
      assert.equal((await optimisticRequester.methods.timestamp().call()).toString(), requestTime.toString());
      assert.equal((await optimisticRequester.methods.refund().call()).toString(), reward);

      // Price should be unset as this callback has not been received yet.
      assert.equal((await optimisticRequester.methods.price().call()).toString(), "0");
    });

    it("Callback on priceSettled not enabled", async function () {
      // Callbacks are disabled by default, so setting callbacks to revert would not affect price settlement.
      await optimisticRequester.methods.setRevert(true).send({ from: accounts[0] });

      // Propose price, dispute, push price and settle.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });
      await pushPrice(correctPrice);
      await optimisticOracle.methods
        .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: accounts[0] });

      // No state variables should be set.
      assert.equal(hexToUtf8(await optimisticRequester.methods.identifier().call()), "");
      assert.equal((await optimisticRequester.methods.timestamp().call()).toString(), "0");
      assert.equal((await optimisticRequester.methods.price().call()).toString(), "0");
      assert.equal((await optimisticRequester.methods.refund().call()).toString(), "0");
    });

    it("Callback on priceSettled enabled", async function () {
      // Enable only priceSettled callback.
      const [callbackOnPriceProposed, callbackOnPriceDisputed, callbackOnPriceSettled] = [false, false, true];
      await optimisticRequester.methods
        .setCallbacks(
          identifier,
          requestTime,
          "0x",
          callbackOnPriceProposed,
          callbackOnPriceDisputed,
          callbackOnPriceSettled
        )
        .send({ from: accounts[0] });

      // Propose price and dispute.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });

      // No state variables should be set.
      assert.equal(hexToUtf8(await optimisticRequester.methods.identifier().call()), "");
      assert.equal((await optimisticRequester.methods.timestamp().call()).toString(), "0");
      assert.equal((await optimisticRequester.methods.price().call()).toString(), "0");
      assert.equal((await optimisticRequester.methods.refund().call()).toString(), "0");

      // Push price and settle.
      await pushPrice(correctPrice);
      await optimisticOracle.methods
        .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: accounts[0] });

      // Timestamp, identifier, and price should be set.
      assert.equal(hexToUtf8(await optimisticRequester.methods.identifier().call()), hexToUtf8(identifier));
      assert.equal((await optimisticRequester.methods.timestamp().call()).toString(), requestTime.toString());
      assert.equal((await optimisticRequester.methods.price().call()).toString(), correctPrice);

      // Refund should be unset as this callback has not been received.
      assert.equal((await optimisticRequester.methods.refund().call()).toString(), "0");
    });
  });

  describe("Proposed correctly", function () {
    beforeEach(async function () {
      await collateral.methods.transfer(optimisticRequester.options.address, reward).send({ from: accounts[0] });
      await optimisticRequester.methods
        .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward)
        .send({ from: accounts[0] });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", correctPrice)
        .send({ from: proposer });
    });

    it("Default liveness", async function () {
      await optimisticOracle.methods.setCurrentTime(defaultExpiryTime).send({ from: accounts[0] });
      await verifyState(OptimisticOracleRequestStatesEnum.EXPIRED);

      // Settle contract and check results.
      await optimisticOracle.methods
        .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: accounts[0] });

      // Proposer should only net the reward.
      await verifyBalanceSum(proposer, initialUserBalance, reward);
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED);
      await verifyCorrectPrice();
    });

    it("Can't settle before default liveness", async function () {
      await optimisticOracle.methods.setCurrentTime(defaultExpiryTime - 1).send({ from: accounts[0] });
      await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED);
      assert(
        await didContractThrow(
          optimisticOracle.methods
            .settle(optimisticRequester.options.address, identifier, requestTime, "0x")
            .send({ from: accounts[0] })
        )
      );
    });

    it("Disputed", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });
      await verifyState(OptimisticOracleRequestStatesEnum.DISPUTED);
      await verifyBalanceSum(
        optimisticOracle.options.address,
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
      await optimisticRequester.methods.settleAndGetPrice(identifier, requestTime, "0x").send({ from: accounts[0] }); // Should do the same thing as settle.
      await verifyCorrectPrice();
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED);

      // Proposer should net half the bond and the reward.
      await verifyBalanceSum(proposer, initialUserBalance, halfDefaultBond, reward);

      // Disputer should have lost their bond.
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should be empty.
      await verifyBalanceSum(optimisticOracle.options.address);

      // Store should have a final fee.
      await verifyBalanceSum(store.options.address, finalFee, halfDefaultBond);
    });
  });

  describe("Proposed incorrectly", function () {
    beforeEach(async function () {
      await collateral.methods.transfer(optimisticRequester.options.address, reward).send({ from: accounts[0] });
      await optimisticRequester.methods
        .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward)
        .send({ from: accounts[0] });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, "0x", incorrectPrice)
        .send({ from: proposer });
    });

    it("Disputed", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });

      // Push price.
      await pushPrice(correctPrice);
      await verifyState(OptimisticOracleRequestStatesEnum.RESOLVED);

      // Settle and check price and payouts.
      await optimisticRequester.methods.settleAndGetPrice(identifier, requestTime, "0x").send({ from: accounts[0] }); // Should do the same thing as settle.
      await verifyCorrectPrice();
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED);

      // Disputer should net the bond and the reward.
      await verifyBalanceSum(disputer, initialUserBalance, halfDefaultBond, reward);

      // Proposer should have lost thier bond.
      await verifyBalanceSum(proposer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should be empty.
      await verifyBalanceSum(optimisticOracle.options.address);

      // Store should have a final fee.
      await verifyBalanceSum(store.options.address, finalFee, halfDefaultBond);
    });

    it("Should Revert When Dispute For With 0 Address", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      const request = optimisticOracle.methods
        .disputePriceFor(
          "0x0000000000000000000000000000000000000000",
          optimisticRequester.options.address,
          identifier,
          requestTime,
          "0x"
        )
        .send({ from: disputer });
      assert(await didContractThrow(request));
    });

    it("Dispute For", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePriceFor(rando, optimisticRequester.options.address, identifier, requestTime, "0x")
        .send({ from: disputer });

      // Push price and settle.
      await pushPrice(correctPrice);
      await optimisticRequester.methods.settleAndGetPrice(identifier, requestTime, "0x").send({ from: accounts[0] }); // Same as settle.

      // Rando should net half the loser's bond, reward, and the full bond the disputer paid in.
      await verifyBalanceSum(rando, initialUserBalance, halfDefaultBond, reward, totalDefaultBond);

      // Disputer should have lost their bond (since they effectively gave it to rando).
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalDefaultBond}`);

      // Proposer should have lost their bond.
      await verifyBalanceSum(proposer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should be empty.
      await verifyBalanceSum(optimisticOracle.options.address);

      // Store should have a final fee.
      await verifyBalanceSum(store.options.address, finalFee, halfDefaultBond);
    });
  });

  describe("Ancillary Data stamping", function () {
    // Max ancillary data length allowed by optimistic oracle:
    const DATA_LIMIT_BYTES = 8192;
    // Length of stamped ancillary data appended by optimistic oracle:
    // - ",ooRequester:<address>", where `,ooRequester:` is 13 bytes and the address is 40 bytes.
    const STAMPED_LENGTH = 13 + 40;
    // Max length of original ancillary data (i.e. pre-stamped) is the data limit minus the additional stamped length.
    const MAX_ANCILLARY_DATA_LENGTH = DATA_LIMIT_BYTES - STAMPED_LENGTH;

    it("Appends to original ancillary data", async function () {
      const ancillaryData = utf8ToHex("key:value,key2:value2");

      // Initial state.
      await verifyState(OptimisticOracleRequestStatesEnum.INVALID, ancillaryData);
      assert.isNull(await optimisticRequester.methods.ancillaryData().call());

      // Requested.
      await collateral.methods.transfer(optimisticRequester.options.address, reward).send({ from: accounts[0] });
      await optimisticRequester.methods
        .requestPrice(identifier, requestTime, ancillaryData, collateral.options.address, reward)
        .send({ from: accounts[0] });
      await verifyState(OptimisticOracleRequestStatesEnum.REQUESTED, ancillaryData);

      // Enable all callbacks to detect updating ancillaryData state variable in requester.
      const [callbackOnPriceProposed, callbackOnPriceDisputed, callbackOnPriceSettled] = [true, true, true];
      await optimisticRequester.methods
        .setCallbacks(
          identifier,
          requestTime,
          ancillaryData,
          callbackOnPriceProposed,
          callbackOnPriceDisputed,
          callbackOnPriceSettled
        )
        .send({ from: accounts[0] });

      // Proposed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, ancillaryData, incorrectPrice)
        .send({ from: proposer });
      await verifyState(OptimisticOracleRequestStatesEnum.PROPOSED, ancillaryData);
      assert.equal(await optimisticRequester.methods.ancillaryData().call(), ancillaryData);
      await optimisticRequester.methods.clearState().send({ from: accounts[0] });

      // Disputed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, ancillaryData)
        .send({ from: disputer });
      await verifyState(OptimisticOracleRequestStatesEnum.DISPUTED, ancillaryData);
      assert.equal(await optimisticRequester.methods.ancillaryData().call(), ancillaryData);
      await optimisticRequester.methods.clearState().send({ from: accounts[0] });

      // Check that OptimisticOracle stamped ancillary data as expected before sending to Oracle, and that we can decode
      // it.
      const priceRequests = await mockOracle.getPastEvents("PriceRequestAdded", { fromBlock: 0 });
      assert.equal(priceRequests.length, 1, "should only be one price request escalated to MockOracle");
      const stampedAncillaryData = priceRequests[0].returnValues.ancillaryData;
      assert.equal(
        hexToUtf8(stampedAncillaryData),
        `${hexToUtf8(ancillaryData)},ooRequester:${optimisticRequester.options.address.substr(2).toLowerCase()}`
      );

      // Settled
      await pushPrice(correctPrice);
      await optimisticRequester.methods
        .settleAndGetPrice(identifier, requestTime, ancillaryData)
        .send({ from: accounts[0] });
      await verifyState(OptimisticOracleRequestStatesEnum.SETTLED, ancillaryData);
      assert.equal(await optimisticRequester.methods.ancillaryData().call(), ancillaryData);
    });

    it("Original ancillary data is empty", async function () {
      const ancillaryData = utf8ToHex("");

      // Requested.
      await collateral.methods.transfer(optimisticRequester.options.address, reward).send({ from: accounts[0] });
      await optimisticRequester.methods
        .requestPrice(identifier, requestTime, ancillaryData, collateral.options.address, reward)
        .send({ from: accounts[0] });

      // Proposed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, ancillaryData, incorrectPrice)
        .send({ from: proposer });

      // Disputed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, ancillaryData)
        .send({ from: disputer });

      // Check that OptimisticOracle stamped ancillary data as expected before sending to Oracle, and that we can decode
      // it.
      const priceRequests = await mockOracle.getPastEvents("PriceRequestAdded", { fromBlock: 0 });
      assert.equal(priceRequests.length, 1, "should only be one price request escalated to MockOracle");
      const stampedAncillaryData = priceRequests[0].returnValues.ancillaryData;
      assert.equal(
        hexToUtf8(stampedAncillaryData),
        `ooRequester:${optimisticRequester.options.address.substr(2).toLowerCase()}`,
        "Should not stamp with a leading comma ','"
      );
    });

    it("Original ancillary data is not UTF8-encodeable", async function () {
      const ancillaryData = "0xabcd";

      // Requested.
      await collateral.methods.transfer(optimisticRequester.options.address, reward).send({ from: accounts[0] });
      await optimisticRequester.methods
        .requestPrice(identifier, requestTime, ancillaryData, collateral.options.address, reward)
        .send({ from: accounts[0] });

      // Proposed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(optimisticRequester.options.address, identifier, requestTime, ancillaryData, incorrectPrice)
        .send({ from: proposer });

      // Disputed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(optimisticRequester.options.address, identifier, requestTime, ancillaryData)
        .send({ from: disputer });

      // Check that OptimisticOracle stamped ancillary data as expected before sending to Oracle, and that we can decode
      // it.
      const priceRequests = await mockOracle.getPastEvents("PriceRequestAdded", { fromBlock: 0 });
      assert.equal(priceRequests.length, 1, "should only be one price request escalated to MockOracle");
      const stampedAncillaryData = priceRequests[0].returnValues.ancillaryData;

      // We know that the stamped ancillary data forms the last 53 bytes, so we can decode the last 53 bytes
      // (106 chars) to utf8.
      const utf8EncodedAncillaryData = hexToUtf8(
        "0x" + stampedAncillaryData.substr(stampedAncillaryData.length - STAMPED_LENGTH * 2)
      );
      assert.equal(
        utf8EncodedAncillaryData,
        `,ooRequester:${optimisticRequester.options.address.substr(2).toLowerCase()}`,
        "Should be able to decode trailing stamped component of ancillary data"
      );
    });

    it("Stress testing the size of ancillary data", async function () {
      let ancillaryData = web3.utils.randomHex(MAX_ANCILLARY_DATA_LENGTH);

      // Initial state.
      await verifyState(OptimisticOracleRequestStatesEnum.INVALID, ancillaryData);
      assert.isNull(await optimisticRequester.methods.ancillaryData().call());

      // Requested.
      await collateral.methods.transfer(optimisticRequester.options.address, reward).send({ from: accounts[0] });
      assert(
        await didContractThrow(
          optimisticRequester.methods
            .requestPrice(
              identifier,
              requestTime,
              web3.utils.randomHex(MAX_ANCILLARY_DATA_LENGTH + 1),
              collateral.options.address,
              reward
            )
            .send({ from: accounts[0] })
        )
      );

      // Show ancillary succeeds if you don't add 1 byte:
      await optimisticRequester.methods
        .requestPrice(
          identifier,
          requestTime,
          web3.utils.randomHex(MAX_ANCILLARY_DATA_LENGTH),
          collateral.options.address,
          reward
        )
        .send({ from: accounts[0] });
    });
  });
});
