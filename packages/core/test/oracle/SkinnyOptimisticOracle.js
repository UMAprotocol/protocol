const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { OptimisticOracleRequestStatesEnum, didContractThrow, interfaceName, ZERO_ADDRESS } = require("@uma/common");
const { assert } = require("chai");

const { toWei, toBN, hexToUtf8, utf8ToHex } = web3.utils;

const SkinnyOptimisticOracle = getContract("SkinnyOptimisticOracle");
const OptimisticRequester = getContract("SkinnyOptimisticRequesterTest");
const Finder = getContract("Finder");
const Timer = getContract("Timer");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Addresswhitelist = getContract("AddressWhitelist");
const Token = getContract("ExpandedERC20");
const Store = getContract("Store");
const MockOracle = getContract("MockOracleAncillary");

describe("SkinnyOptimisticOracle", function () {
  let optimisticOracle;
  let optimisticRequester;
  let finder;
  let timer;
  let identifierWhitelist;
  let collateralWhitelist;
  let collateral;
  let identifier;
  let store;
  let mockOracle;
  let requestTime;
  let defaultExpiryTime;
  let customExpiryTime;
  let startTime;
  let requestParams;
  let noFeeRequestParams;
  let postProposalParams;
  let postDisputeParams;
  let postSettleExpiryParams;

  // Precomputed params
  const liveness = 7200; // 2 hours
  const customLiveness = 14400; // 4 hours.
  const reward = toWei("0.5");
  const finalFee = toWei("1");
  const halfDefaultBond = toWei("0.5"); // Default bond = final fee = 1e18.
  const defaultBond = toWei("1");
  const totalDefaultBond = toWei("2"); // Total default bond = final fee + default bond = 2e18
  const correctPrice = toWei("-17");
  const incorrectPrice = toWei("10");
  const initialUserBalance = toWei("100");

  // Accounts
  let accounts;
  let owner;
  let requester;
  let proposer;
  let disputer;
  let rando;

  const verifyState = async (state, requester, identifier, requestTime, ancillaryData, request) => {
    assert.equal(
      (
        await optimisticOracle.methods.getState(requester, identifier, requestTime, ancillaryData, request).call()
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

  const pushPrice = async (price) => {
    const [lastQuery] = (await mockOracle.methods.getPendingQueries().call()).slice(-1);
    await mockOracle.methods
      .pushPrice(lastQuery.identifier, lastQuery.time, lastQuery.ancillaryData, price)
      .send({ from: accounts[0] });
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, requester, proposer, disputer, rando] = accounts;
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

    // These are the default request params for any new request.
    requestParams = {
      proposer: ZERO_ADDRESS,
      disputer: ZERO_ADDRESS,
      currency: collateral.options.address,
      settled: false,
      proposedPrice: "0",
      resolvedPrice: "0",
      expirationTime: "0",
      reward: reward,
      finalFee: finalFee,
      bond: finalFee,
      customLiveness: "0",
    };

    optimisticOracle = await SkinnyOptimisticOracle.new(liveness, finder.options.address, timer.options.address).send({
      from: accounts[0],
    });

    optimisticRequester = await OptimisticRequester.new(optimisticOracle.options.address, finder.options.address).send({
      from: accounts[0],
    });

    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: accounts[0] });

    startTime = parseInt(await optimisticOracle.methods.getCurrentTime().call());
    requestTime = parseInt(await optimisticOracle.methods.getCurrentTime().call()) - 10;
    defaultExpiryTime = startTime + liveness;
    customExpiryTime = startTime + customLiveness;

    // These are request parameter structs that are reused in this file.
    noFeeRequestParams = { ...requestParams, reward: "0" };
    postProposalParams = (
      _requestParams,
      _expirationTime = defaultExpiryTime.toString(),
      _proposedPrice = correctPrice
    ) => {
      return { ..._requestParams, expirationTime: _expirationTime, proposer, proposedPrice: _proposedPrice };
    };
    postDisputeParams = (_requestParams) => {
      return { ..._requestParams, disputer };
    };
    postSettleExpiryParams = (_requestParams, _resolvedPrice = correctPrice) => {
      return { ..._requestParams, resolvedPrice: _resolvedPrice, settled: true };
    };
  });

  it("Contract creation checks", async function () {
    // Liveness too large.
    assert(
      await didContractThrow(
        SkinnyOptimisticOracle.new(toWei("1"), finder.options.address, timer.options.address).send({
          from: accounts[0],
        })
      )
    );

    // Liveness too small.
    assert(
      await didContractThrow(
        SkinnyOptimisticOracle.new(0, finder.options.address, timer.options.address).send({ from: accounts[0] })
      )
    );
  });

  it("Initial invalid state", async function () {
    // Note: Need to set `currency=0x` to get this to return INVALID
    await verifyState(OptimisticOracleRequestStatesEnum.INVALID, requester, identifier, requestTime, "0x", {
      ...requestParams,
      currency: ZERO_ADDRESS,
    });
  });

  it("Request timestamp in the future", async function () {
    const currentTime = parseInt(await optimisticOracle.methods.getCurrentTime().call());

    // Request for current time is okay.
    await optimisticOracle.methods
      .requestPrice(identifier, currentTime, "0x", collateral.options.address, 0, 0, 0)
      .send({ from: accounts[0] });

    // 1 second in the future is not okay.
    assert(
      await didContractThrow(
        optimisticOracle.methods
          .requestPrice(identifier, currentTime + 1, "0x", collateral.options.address, 0, 0, 0)
          .send({ from: accounts[0] })
      )
    );
  });

  it("No fee request", async function () {
    await optimisticOracle.methods
      .requestPrice(identifier, requestTime, "0x", collateral.options.address, 0, 0, 0)
      .send({ from: accounts[0] });
    await verifyState(
      OptimisticOracleRequestStatesEnum.REQUESTED,
      requester,
      identifier,
      requestTime,
      "0x",
      requestParams
    );
  });

  it("Fees are required when specified", async function () {
    assert(
      await didContractThrow(
        optimisticOracle.methods
          .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward, 0, 0)
          .send({ from: accounts[0] })
      )
    );
  });

  it("Fee request", async function () {
    await collateral.methods.transfer(requester, reward).send({ from: accounts[0] });
    await collateral.methods.increaseAllowance(optimisticOracle.options.address, reward).send({ from: requester });

    const requestTxn = optimisticOracle.methods.requestPrice(
      identifier,
      requestTime,
      "0x",
      collateral.options.address,
      reward,
      0,
      0
    );
    const returnValue = await requestTxn.call({ from: requester });
    assert.equal(returnValue, totalDefaultBond);

    await assertEventEmitted(await requestTxn.send({ from: requester }), optimisticOracle, "RequestPrice", (ev) => {
      return (
        ev.requester === requester &&
        hexToUtf8(ev.identifier) == hexToUtf8(identifier) &&
        ev.timestamp.toString() === requestTime.toString() &&
        ev.ancillaryData === null &&
        ev.request.proposer === requestParams.proposer &&
        ev.request.disputer === requestParams.disputer &&
        ev.request.currency === requestParams.currency &&
        ev.request.settled === requestParams.settled &&
        ev.request.proposedPrice === requestParams.proposedPrice &&
        ev.request.resolvedPrice === requestParams.resolvedPrice &&
        ev.request.expirationTime === requestParams.expirationTime &&
        ev.request.reward === requestParams.reward &&
        ev.request.finalFee === requestParams.finalFee &&
        ev.request.bond === requestParams.bond &&
        ev.request.customLiveness === requestParams.customLiveness
      );
    });

    await verifyState(
      OptimisticOracleRequestStatesEnum.REQUESTED,
      requester,
      identifier,
      requestTime,
      "0x",
      requestParams
    );
    await verifyBalanceSum(optimisticOracle.options.address, reward);
  });

  it("Bond burned when final fee == 0", async function () {
    // Set final fee and prep request.
    await store.methods.setFinalFee(collateral.options.address, { rawValue: "0" }).send({ from: accounts[0] });
    await collateral.methods.transfer(requester, reward).send({ from: accounts[0] });
    await collateral.methods.increaseAllowance(optimisticOracle.options.address, reward).send({ from: requester });

    // Must set the bond because it defaults to the final fee, which is 0.
    await optimisticOracle.methods
      .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward, defaultBond, 0)
      .send({ from: requester });
    let modifiedRequestParams = { ...requestParams, finalFee: "0", bond: defaultBond };

    // Note: defaultBond does _not_ include the final fee.
    await collateral.methods.approve(optimisticOracle.options.address, defaultBond).send({ from: proposer });
    await optimisticOracle.methods
      .proposePrice(requester, identifier, requestTime, "0x", modifiedRequestParams, correctPrice)
      .send({ from: proposer });
    await collateral.methods.approve(optimisticOracle.options.address, defaultBond).send({ from: disputer });
    await optimisticOracle.methods
      .disputePrice(requester, identifier, requestTime, "0x", postProposalParams(modifiedRequestParams))
      .send({ from: disputer });
    //   modifiedRequestParams = { ...modifiedRequestParams, disputer }

    // Settle.
    await pushPrice(correctPrice);
    await optimisticOracle.methods
      .settle(requester, identifier, requestTime, "0x", postDisputeParams(postProposalParams(modifiedRequestParams)))
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
      await optimisticOracle.methods
        .requestPrice(identifier, requestTime, "0x", collateral.options.address, 0, 0, 0)
        .send({ from: requester });
    });

    it("Reverts if request params do not match stored request hash", async function () {
      // Call `hasPrice` with modified request params. In this example, we use `requestParams` but we should be using
      // `noFeeRequestParams`
      assert(
        await didContractThrow(
          optimisticOracle.methods.hasPrice(requester, identifier, requestTime, "0x", requestParams).call()
        )
      );
    });

    it("Should return false when no price was ever proposed", async function () {
      const result = await optimisticOracle.methods
        .hasPrice(requester, identifier, requestTime, "0x", noFeeRequestParams)
        .call();
      assert.equal(result, false);
    });

    it("Should return false when price is proposed but not past liveness", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(requester, identifier, requestTime, "0x", noFeeRequestParams, correctPrice)
        .send({ from: proposer });
      const result = await optimisticOracle.methods
        .hasPrice(requester, identifier, requestTime, "0x", postProposalParams(noFeeRequestParams))
        .call();
      assert.equal(result, false);
    });

    it("Should return false when price is proposed and disputed", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(requester, identifier, requestTime, "0x", noFeeRequestParams, correctPrice)
        .send({ from: proposer });

      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(requester, identifier, requestTime, "0x", postProposalParams(noFeeRequestParams))
        .send({ from: disputer });

      const result = await optimisticOracle.methods
        .hasPrice(requester, identifier, requestTime, "0x", postDisputeParams(postProposalParams(noFeeRequestParams)))
        .call();
      assert.equal(result, false);
    });

    it("Should return true when price is proposed and past liveness but not settled", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(requester, identifier, requestTime, "0x", noFeeRequestParams, correctPrice)
        .send({ from: proposer });

      await timer.methods
        .setCurrentTime(
          toBN(await timer.methods.getCurrentTime().call()).add(
            toBN(await optimisticOracle.methods.defaultLiveness().call())
          )
        )
        .send({ from: accounts[0] });
      const result = await optimisticOracle.methods
        .hasPrice(requester, identifier, requestTime, "0x", postProposalParams(noFeeRequestParams))
        .call();
      assert.equal(result, true);
    });

    it("Should return true when price is proposed, disputed and resolved by dvm", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(requester, identifier, requestTime, "0x", noFeeRequestParams, correctPrice)
        .send({ from: proposer });

      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(requester, identifier, requestTime, "0x", postProposalParams(noFeeRequestParams))
        .send({ from: disputer });

      await pushPrice(correctPrice);
      const result = await optimisticOracle.methods
        .hasPrice(requester, identifier, requestTime, "0x", postDisputeParams(postProposalParams(noFeeRequestParams)))
        .call();
      assert.equal(result, true);
    });

    it("Should return true when price is proposed, past liveness and settled", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(requester, identifier, requestTime, "0x", noFeeRequestParams, correctPrice)
        .send({ from: proposer });

      await timer.methods
        .setCurrentTime(
          toBN(await timer.methods.getCurrentTime().call()).add(
            toBN(await optimisticOracle.methods.defaultLiveness().call())
          )
        )
        .send({ from: accounts[0] });
      await optimisticOracle.methods
        .settle(requester, identifier, requestTime, "0x", postProposalParams(noFeeRequestParams))
        .send({ from: accounts[0] });

      const result = await optimisticOracle.methods
        .hasPrice(
          requester,
          identifier,
          requestTime,
          "0x",
          postSettleExpiryParams(postProposalParams(noFeeRequestParams))
        )
        .call();
      assert.equal(result, true);
    });
  });

  describe("Requested", function () {
    beforeEach(async function () {
      await collateral.methods.transfer(requester, reward).send({ from: accounts[0] });
      await collateral.methods.increaseAllowance(optimisticOracle.options.address, reward).send({ from: requester });
    });
    describe("Default bond and liveness", function () {
      beforeEach(async function () {
        await optimisticOracle.methods
          .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward, 0, 0)
          .send({ from: requester });
      });

      it("Cannot re-request", async function () {
        assert(
          await didContractThrow(
            optimisticOracle.methods
              .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward, 0, 0)
              .send({ from: requester })
          )
        );
      });

      it("Default proposal", async function () {
        await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
        const proposeTxn = optimisticOracle.methods.proposePrice(
          requester,
          identifier,
          requestTime,
          "0x",
          requestParams,
          correctPrice
        );
        const returnValue = await proposeTxn.call({ from: proposer });
        assert.equal(returnValue, totalDefaultBond);

        await assertEventEmitted(await proposeTxn.send({ from: proposer }), optimisticOracle, "ProposePrice", (ev) => {
          return (
            ev.requester === requester &&
            hexToUtf8(ev.identifier) == hexToUtf8(identifier) &&
            ev.timestamp.toString() === requestTime.toString() &&
            ev.ancillaryData === null &&
            ev.request.proposer === postProposalParams(requestParams).proposer &&
            ev.request.disputer === postProposalParams(requestParams).disputer &&
            ev.request.currency === postProposalParams(requestParams).currency &&
            ev.request.settled === postProposalParams(requestParams).settled &&
            ev.request.proposedPrice === postProposalParams(requestParams).proposedPrice &&
            ev.request.resolvedPrice === postProposalParams(requestParams).resolvedPrice &&
            ev.request.expirationTime === postProposalParams(requestParams).expirationTime &&
            ev.request.reward === postProposalParams(requestParams).reward &&
            ev.request.finalFee === postProposalParams(requestParams).finalFee &&
            ev.request.bond === postProposalParams(requestParams).bond &&
            ev.request.customLiveness === postProposalParams(requestParams).customLiveness
          );
        });

        await verifyState(
          OptimisticOracleRequestStatesEnum.PROPOSED,
          requester,
          identifier,
          requestTime,
          "0x",
          postProposalParams(requestParams)
        );
        await verifyBalanceSum(optimisticOracle.options.address, reward, totalDefaultBond);
      });

      it("Should Revert When Proposed For With 0 Address", async function () {
        await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
        const request = optimisticOracle.methods
          .proposePriceFor(
            requester,
            identifier,
            requestTime,
            "0x",
            requestParams,
            "0x0000000000000000000000000000000000000000",
            correctPrice
          )
          .send({ from: proposer });
        assert(await didContractThrow(request));
      });

      it("Propose For", async function () {
        // Bond should be pulled from caller, but rando should receive proposer rewards.
        await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
        await optimisticOracle.methods
          .proposePriceFor(requester, identifier, requestTime, "0x", requestParams, rando, correctPrice)
          .send({ from: proposer });
        await optimisticOracle.methods.setCurrentTime(defaultExpiryTime).send({ from: accounts[0] });
        await optimisticOracle.methods
          .settle(requester, identifier, requestTime, "0x", { ...postProposalParams(requestParams), proposer: rando })
          .send({ from: accounts[0] });

        // Note: rando should receive a BIGGER bonus over their initial balance because the initial bond didn't come out of their wallet.
        await verifyBalanceSum(rando, initialUserBalance, totalDefaultBond, reward);
      });
    });
    describe("Custom bond and liveness", function () {
      it("Burned bond rounding", async function () {
        // Set bond such that rounding will occur: 1e18 + 1.
        const bond = toBN(toWei("1")).addn(1);
        const totalBond = bond.add(toBN(finalFee));
        const halfBondCeil = bond.divn(2).addn(1);
        const halfBondFloor = bond.divn(2);

        let modifiedRequestParams = { ...requestParams, bond: bond.toString() };
        await optimisticOracle.methods
          .requestPrice(
            identifier,
            requestTime,
            "0x",
            collateral.options.address,
            reward,
            modifiedRequestParams.bond,
            0
          )
          .send({ from: requester });
        await collateral.methods.approve(optimisticOracle.options.address, totalBond).send({ from: proposer });
        await optimisticOracle.methods
          .proposePrice(requester, identifier, requestTime, "0x", modifiedRequestParams, correctPrice)
          .send({ from: proposer });

        await collateral.methods.approve(optimisticOracle.options.address, totalBond).send({ from: disputer });
        await optimisticOracle.methods
          .disputePrice(requester, identifier, requestTime, "0x", postProposalParams(modifiedRequestParams))
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
          .settle(
            requester,
            identifier,
            requestTime,
            "0x",
            postDisputeParams(postProposalParams(modifiedRequestParams))
          )
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
      it("Custom liveness", async function () {
        let modifiedRequestParams = { ...requestParams, customLiveness };
        await optimisticOracle.methods
          .requestPrice(
            identifier,
            requestTime,
            "0x",
            collateral.options.address,
            reward,
            0,
            modifiedRequestParams.customLiveness
          )
          .send({ from: requester });

        await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });

        await optimisticOracle.methods
          .proposePrice(requester, identifier, requestTime, "0x", modifiedRequestParams, correctPrice)
          .send({ from: proposer });
        await optimisticOracle.methods.setCurrentTime(customExpiryTime - 1).send({ from: accounts[0] });
        await verifyState(
          OptimisticOracleRequestStatesEnum.PROPOSED,
          requester,
          identifier,
          requestTime,
          "0x",
          postProposalParams(modifiedRequestParams, customExpiryTime)
        );
        assert(
          await didContractThrow(
            optimisticOracle.methods
              .settle(
                requester,
                identifier,
                requestTime,
                "0x",
                postProposalParams(modifiedRequestParams, customExpiryTime)
              )
              .send({ from: accounts[0] })
          )
        );

        await optimisticOracle.methods.setCurrentTime(customExpiryTime).send({ from: accounts[0] });
        await verifyState(
          OptimisticOracleRequestStatesEnum.EXPIRED,
          requester,
          identifier,
          requestTime,
          "0x",
          postProposalParams(modifiedRequestParams, customExpiryTime)
        );
        await optimisticOracle.methods
          .settle(requester, identifier, requestTime, "0x", postProposalParams(modifiedRequestParams, customExpiryTime))
          .send({ from: accounts[0] });
      });
    });
  });

  describe("Proposed correctly", function () {
    beforeEach(async function () {
      await collateral.methods.transfer(requester, reward).send({ from: accounts[0] });
      await collateral.methods.increaseAllowance(optimisticOracle.options.address, reward).send({ from: requester });
      await optimisticOracle.methods
        .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward, 0, 0)
        .send({ from: requester });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(requester, identifier, requestTime, "0x", requestParams, correctPrice)
        .send({ from: proposer });
    });

    it("Settle expired proposal", async function () {
      await optimisticOracle.methods.setCurrentTime(defaultExpiryTime - 1).send({ from: accounts[0] });
      await verifyState(
        OptimisticOracleRequestStatesEnum.PROPOSED,
        requester,
        identifier,
        requestTime,
        "0x",
        postProposalParams(requestParams)
      );
      assert(
        await didContractThrow(
          optimisticOracle.methods
            .settle(requester, identifier, requestTime, "0x", postProposalParams(requestParams))
            .send({ from: accounts[0] })
        )
      );

      await optimisticOracle.methods.setCurrentTime(defaultExpiryTime).send({ from: accounts[0] });
      await verifyState(
        OptimisticOracleRequestStatesEnum.EXPIRED,
        requester,
        identifier,
        requestTime,
        "0x",
        postProposalParams(requestParams)
      );

      // Settle contract and check results.
      const settleTxn = optimisticOracle.methods.settle(
        requester,
        identifier,
        requestTime,
        "0x",
        postProposalParams(requestParams)
      );
      const returnValues = await settleTxn.call({ from: accounts[0] });
      assert.equal(returnValues.resolvedPrice, correctPrice);
      assert.equal(returnValues.payout, toBN(totalDefaultBond).add(toBN(reward)).toString());

      await assertEventEmitted(await settleTxn.send({ from: accounts[0] }), optimisticOracle, "Settle", (ev) => {
        return (
          ev.requester === requester &&
          hexToUtf8(ev.identifier) == hexToUtf8(identifier) &&
          ev.timestamp.toString() === requestTime.toString() &&
          ev.ancillaryData === null &&
          ev.request.proposer === postSettleExpiryParams(postProposalParams(requestParams)).proposer &&
          ev.request.disputer === postSettleExpiryParams(postProposalParams(requestParams)).disputer &&
          ev.request.currency === postSettleExpiryParams(postProposalParams(requestParams)).currency &&
          ev.request.settled === postSettleExpiryParams(postProposalParams(requestParams)).settled &&
          ev.request.proposedPrice === postSettleExpiryParams(postProposalParams(requestParams)).proposedPrice &&
          ev.request.resolvedPrice === postSettleExpiryParams(postProposalParams(requestParams)).resolvedPrice &&
          ev.request.expirationTime === postSettleExpiryParams(postProposalParams(requestParams)).expirationTime &&
          ev.request.reward === postSettleExpiryParams(postProposalParams(requestParams)).reward &&
          ev.request.finalFee === postSettleExpiryParams(postProposalParams(requestParams)).finalFee &&
          ev.request.bond === postSettleExpiryParams(postProposalParams(requestParams)).bond &&
          ev.request.customLiveness === postSettleExpiryParams(postProposalParams(requestParams)).customLiveness
        );
      });

      // Proposer should only net the reward.
      await verifyBalanceSum(proposer, initialUserBalance, reward);
      await verifyState(
        OptimisticOracleRequestStatesEnum.SETTLED,
        requester,
        identifier,
        requestTime,
        "0x",
        postSettleExpiryParams(postProposalParams(requestParams))
      );
    });

    it("Disputed", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });

      const disputeTxn = optimisticOracle.methods.disputePrice(
        requester,
        identifier,
        requestTime,
        "0x",
        postProposalParams(requestParams)
      );
      const returnValue = await disputeTxn.call({ from: disputer });
      assert.equal(returnValue, totalDefaultBond);
      await assertEventEmitted(await disputeTxn.send({ from: disputer }), optimisticOracle, "DisputePrice", (ev) => {
        return (
          ev.requester === requester &&
          hexToUtf8(ev.identifier) == hexToUtf8(identifier) &&
          ev.timestamp.toString() === requestTime.toString() &&
          ev.ancillaryData === null &&
          ev.request.proposer === postDisputeParams(postProposalParams(requestParams)).proposer &&
          ev.request.disputer === postDisputeParams(postProposalParams(requestParams)).disputer &&
          ev.request.currency === postDisputeParams(postProposalParams(requestParams)).currency &&
          ev.request.settled === postDisputeParams(postProposalParams(requestParams)).settled &&
          ev.request.proposedPrice === postDisputeParams(postProposalParams(requestParams)).proposedPrice &&
          ev.request.resolvedPrice === postDisputeParams(postProposalParams(requestParams)).resolvedPrice &&
          ev.request.expirationTime === postDisputeParams(postProposalParams(requestParams)).expirationTime &&
          ev.request.reward === postDisputeParams(postProposalParams(requestParams)).reward &&
          ev.request.finalFee === postDisputeParams(postProposalParams(requestParams)).finalFee &&
          ev.request.bond === postDisputeParams(postProposalParams(requestParams)).bond &&
          ev.request.customLiveness === postDisputeParams(postProposalParams(requestParams)).customLiveness
        );
      });

      await verifyState(
        OptimisticOracleRequestStatesEnum.DISPUTED,
        requester,
        identifier,
        requestTime,
        "0x",
        postDisputeParams(postProposalParams(requestParams))
      );

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
      await verifyState(
        OptimisticOracleRequestStatesEnum.RESOLVED,
        requester,
        identifier,
        requestTime,
        "0x",
        postDisputeParams(postProposalParams(requestParams))
      );

      // Settle and check price and payouts.
      const settleTxn = optimisticOracle.methods.settle(
        requester,
        identifier,
        requestTime,
        "0x",
        postDisputeParams(postProposalParams(requestParams))
      );
      const returnValues = await settleTxn.call({ from: accounts[0] });
      assert.equal(returnValues.resolvedPrice, correctPrice);
      assert.equal(returnValues.payout, toBN(totalDefaultBond).add(toBN(halfDefaultBond)).add(toBN(reward)).toString());

      await settleTxn.send({ from: accounts[0] });
      await verifyState(
        OptimisticOracleRequestStatesEnum.SETTLED,
        requester,
        identifier,
        requestTime,
        "0x",
        postSettleExpiryParams(postDisputeParams(postProposalParams(requestParams)))
      );

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
      await collateral.methods.transfer(requester, reward).send({ from: accounts[0] });
      await collateral.methods.increaseAllowance(optimisticOracle.options.address, reward).send({ from: requester });
      await optimisticOracle.methods
        .requestPrice(identifier, requestTime, "0x", collateral.options.address, reward, 0, 0)
        .send({ from: requester });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(requester, identifier, requestTime, "0x", requestParams, incorrectPrice)
        .send({ from: proposer });
    });

    it("Disputed", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(
          requester,
          identifier,
          requestTime,
          "0x",
          postProposalParams(requestParams, defaultExpiryTime, incorrectPrice)
        )
        .send({ from: disputer });

      // Push price.
      await pushPrice(correctPrice);
      await verifyState(
        OptimisticOracleRequestStatesEnum.RESOLVED,
        requester,
        identifier,
        requestTime,
        "0x",
        postDisputeParams(postProposalParams(requestParams, defaultExpiryTime, incorrectPrice))
      );

      // Settle and check price and payouts.
      const settleTxn = optimisticOracle.methods.settle(
        requester,
        identifier,
        requestTime,
        "0x",
        postDisputeParams(postProposalParams(requestParams, defaultExpiryTime, incorrectPrice))
      );
      const returnValues = await settleTxn.call({ from: accounts[0] });
      assert.equal(returnValues.resolvedPrice, correctPrice);
      assert.equal(returnValues.payout, toBN(totalDefaultBond).add(toBN(halfDefaultBond)).add(toBN(reward)).toString());
      await settleTxn.send({ from: accounts[0] });
      await verifyState(
        OptimisticOracleRequestStatesEnum.SETTLED,
        requester,
        identifier,
        requestTime,
        "0x",
        postSettleExpiryParams(postDisputeParams(postProposalParams(requestParams, defaultExpiryTime, incorrectPrice)))
      );

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
          identifier,
          requestTime,
          "0x",
          postProposalParams(requestParams, defaultExpiryTime, incorrectPrice),
          "0x0000000000000000000000000000000000000000",
          requester
        )
        .send({ from: disputer });
      assert(await didContractThrow(request));
    });

    it("Dispute For", async function () {
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePriceFor(
          identifier,
          requestTime,
          "0x",
          postProposalParams(requestParams, defaultExpiryTime, incorrectPrice),
          rando,
          requester
        )
        .send({ from: disputer });

      // Push price and settle.
      await pushPrice(correctPrice);
      await optimisticOracle.methods
        .settle(requester, identifier, requestTime, "0x", {
          ...postProposalParams(requestParams, defaultExpiryTime, incorrectPrice),
          disputer: rando,
        })
        .send({ from: accounts[0] });

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

  describe("requestAndProposeFor multicall", function () {
    beforeEach(async function () {
      // Caller must post reward + proposal bond.
      const totalStake = toBN(reward).add(toBN(totalDefaultBond)).toString();
      await collateral.methods.transfer(requester, totalStake).send({ from: accounts[0] });
      await collateral.methods
        .increaseAllowance(optimisticOracle.options.address, totalStake)
        .send({ from: requester });
    });

    it("State and events check", async function () {
      const txn = await optimisticOracle.methods.requestAndProposePriceFor(
        identifier,
        requestTime,
        "0x",
        collateral.options.address,
        reward,
        0,
        0,
        proposer,
        correctPrice
      );
      const returnValue = await txn.call({ from: requester });
      assert.equal(returnValue, totalDefaultBond);
      const txnResult = await txn.send({ from: requester });

      // RequestPrice and ProposePrice should contain the same request params, which is different from the two-step
      // flow where first requestPrice() is called followed by proposePrice().
      await assertEventEmitted(txnResult, optimisticOracle, "ProposePrice", (ev) => {
        return (
          ev.requester === requester &&
          hexToUtf8(ev.identifier) == hexToUtf8(identifier) &&
          ev.timestamp.toString() === requestTime.toString() &&
          ev.ancillaryData === null &&
          ev.request.proposer === postProposalParams(requestParams).proposer &&
          ev.request.disputer === postProposalParams(requestParams).disputer &&
          ev.request.currency === postProposalParams(requestParams).currency &&
          ev.request.settled === postProposalParams(requestParams).settled &&
          ev.request.proposedPrice === postProposalParams(requestParams).proposedPrice &&
          ev.request.resolvedPrice === postProposalParams(requestParams).resolvedPrice &&
          ev.request.expirationTime === postProposalParams(requestParams).expirationTime &&
          ev.request.reward === postProposalParams(requestParams).reward &&
          ev.request.finalFee === postProposalParams(requestParams).finalFee &&
          ev.request.bond === postProposalParams(requestParams).bond &&
          ev.request.customLiveness === postProposalParams(requestParams).customLiveness
        );
      });
      await assertEventEmitted(txnResult, optimisticOracle, "RequestPrice", (ev) => {
        return (
          ev.requester === requester &&
          hexToUtf8(ev.identifier) == hexToUtf8(identifier) &&
          ev.timestamp.toString() === requestTime.toString() &&
          ev.ancillaryData === null &&
          ev.request.proposer === postProposalParams(requestParams).proposer &&
          ev.request.disputer === postProposalParams(requestParams).disputer &&
          ev.request.currency === postProposalParams(requestParams).currency &&
          ev.request.settled === postProposalParams(requestParams).settled &&
          ev.request.proposedPrice === postProposalParams(requestParams).proposedPrice &&
          ev.request.resolvedPrice === postProposalParams(requestParams).resolvedPrice &&
          ev.request.expirationTime === postProposalParams(requestParams).expirationTime &&
          ev.request.reward === postProposalParams(requestParams).reward &&
          ev.request.finalFee === postProposalParams(requestParams).finalFee &&
          ev.request.bond === postProposalParams(requestParams).bond &&
          ev.request.customLiveness === postProposalParams(requestParams).customLiveness
        );
      });

      await verifyState(
        OptimisticOracleRequestStatesEnum.PROPOSED,
        requester,
        identifier,
        requestTime,
        "0x",
        postProposalParams(requestParams)
      );
      await verifyBalanceSum(optimisticOracle.options.address, reward, totalDefaultBond);
    });

    it("Should be able to settle expired normally", async function () {
      await optimisticOracle.methods
        .requestAndProposePriceFor(
          identifier,
          requestTime,
          "0x",
          collateral.options.address,
          reward,
          0,
          0,
          proposer,
          correctPrice
        )
        .send({ from: requester });
      await optimisticOracle.methods.setCurrentTime(defaultExpiryTime - 1).send({ from: accounts[0] });
      await verifyState(
        OptimisticOracleRequestStatesEnum.PROPOSED,
        requester,
        identifier,
        requestTime,
        "0x",
        postProposalParams(requestParams)
      );
      assert(
        await didContractThrow(
          optimisticOracle.methods
            .settle(requester, identifier, requestTime, "0x", postProposalParams(requestParams))
            .send({ from: accounts[0] })
        )
      );

      await optimisticOracle.methods.setCurrentTime(defaultExpiryTime).send({ from: accounts[0] });
      await verifyState(
        OptimisticOracleRequestStatesEnum.EXPIRED,
        requester,
        identifier,
        requestTime,
        "0x",
        postProposalParams(requestParams)
      );

      // Settle contract and check results.
      const settleTxn = optimisticOracle.methods.settle(
        requester,
        identifier,
        requestTime,
        "0x",
        postProposalParams(requestParams)
      );
      const returnValues = await settleTxn.call({ from: accounts[0] });
      assert.equal(returnValues.resolvedPrice, correctPrice);
      assert.equal(returnValues.payout, toBN(totalDefaultBond).add(toBN(reward)).toString());

      await assertEventEmitted(await settleTxn.send({ from: accounts[0] }), optimisticOracle, "Settle", (ev) => {
        return (
          ev.requester === requester &&
          hexToUtf8(ev.identifier) == hexToUtf8(identifier) &&
          ev.timestamp.toString() === requestTime.toString() &&
          ev.ancillaryData === null &&
          ev.request.proposer === postSettleExpiryParams(postProposalParams(requestParams)).proposer &&
          ev.request.disputer === postSettleExpiryParams(postProposalParams(requestParams)).disputer &&
          ev.request.currency === postSettleExpiryParams(postProposalParams(requestParams)).currency &&
          ev.request.settled === postSettleExpiryParams(postProposalParams(requestParams)).settled &&
          ev.request.proposedPrice === postSettleExpiryParams(postProposalParams(requestParams)).proposedPrice &&
          ev.request.resolvedPrice === postSettleExpiryParams(postProposalParams(requestParams)).resolvedPrice &&
          ev.request.expirationTime === postSettleExpiryParams(postProposalParams(requestParams)).expirationTime &&
          ev.request.reward === postSettleExpiryParams(postProposalParams(requestParams)).reward &&
          ev.request.finalFee === postSettleExpiryParams(postProposalParams(requestParams)).finalFee &&
          ev.request.bond === postSettleExpiryParams(postProposalParams(requestParams)).bond &&
          ev.request.customLiveness === postSettleExpiryParams(postProposalParams(requestParams)).customLiveness
        );
      });

      // Proposer should receive reward + total proposal bond.
      await verifyBalanceSum(proposer, initialUserBalance, reward, totalDefaultBond);
      await verifyState(
        OptimisticOracleRequestStatesEnum.SETTLED,
        requester,
        identifier,
        requestTime,
        "0x",
        postSettleExpiryParams(postProposalParams(requestParams))
      );
    });

    it("Should be able to dispute normally", async function () {
      await optimisticOracle.methods
        .requestAndProposePriceFor(
          identifier,
          requestTime,
          "0x",
          collateral.options.address,
          reward,
          0,
          0,
          proposer,
          correctPrice
        )
        .send({ from: requester });
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });

      const disputeTxn = optimisticOracle.methods.disputePrice(
        requester,
        identifier,
        requestTime,
        "0x",
        postProposalParams(requestParams)
      );
      const returnValue = await disputeTxn.call({ from: disputer });
      assert.equal(returnValue, totalDefaultBond);
      await assertEventEmitted(await disputeTxn.send({ from: disputer }), optimisticOracle, "DisputePrice", (ev) => {
        return (
          ev.requester === requester &&
          hexToUtf8(ev.identifier) == hexToUtf8(identifier) &&
          ev.timestamp.toString() === requestTime.toString() &&
          ev.ancillaryData === null &&
          ev.request.proposer === postDisputeParams(postProposalParams(requestParams)).proposer &&
          ev.request.disputer === postDisputeParams(postProposalParams(requestParams)).disputer &&
          ev.request.currency === postDisputeParams(postProposalParams(requestParams)).currency &&
          ev.request.settled === postDisputeParams(postProposalParams(requestParams)).settled &&
          ev.request.proposedPrice === postDisputeParams(postProposalParams(requestParams)).proposedPrice &&
          ev.request.resolvedPrice === postDisputeParams(postProposalParams(requestParams)).resolvedPrice &&
          ev.request.expirationTime === postDisputeParams(postProposalParams(requestParams)).expirationTime &&
          ev.request.reward === postDisputeParams(postProposalParams(requestParams)).reward &&
          ev.request.finalFee === postDisputeParams(postProposalParams(requestParams)).finalFee &&
          ev.request.bond === postDisputeParams(postProposalParams(requestParams)).bond &&
          ev.request.customLiveness === postDisputeParams(postProposalParams(requestParams)).customLiveness
        );
      });

      await verifyState(
        OptimisticOracleRequestStatesEnum.DISPUTED,
        requester,
        identifier,
        requestTime,
        "0x",
        postDisputeParams(postProposalParams(requestParams))
      );

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
      await verifyState(
        OptimisticOracleRequestStatesEnum.RESOLVED,
        requester,
        identifier,
        requestTime,
        "0x",
        postDisputeParams(postProposalParams(requestParams))
      );

      // Settle and check price and payouts.
      const settleTxn = optimisticOracle.methods.settle(
        requester,
        identifier,
        requestTime,
        "0x",
        postDisputeParams(postProposalParams(requestParams))
      );
      const returnValues = await settleTxn.call({ from: accounts[0] });
      assert.equal(returnValues.resolvedPrice, correctPrice);
      assert.equal(returnValues.payout, toBN(totalDefaultBond).add(toBN(halfDefaultBond)).add(toBN(reward)).toString());

      await settleTxn.send({ from: accounts[0] });
      await verifyState(
        OptimisticOracleRequestStatesEnum.SETTLED,
        requester,
        identifier,
        requestTime,
        "0x",
        postSettleExpiryParams(postDisputeParams(postProposalParams(requestParams)))
      );

      // Proposer should net half the disputer's bond plus the reward and receive their proposal bond back.
      await verifyBalanceSum(proposer, initialUserBalance, halfDefaultBond, reward, totalDefaultBond);

      // Disputer should have lost their bond.
      await verifyBalanceSum(disputer, initialUserBalance, `-${totalDefaultBond}`);

      // Contract should be empty.
      await verifyBalanceSum(optimisticOracle.options.address);

      // Store should have a final fee.
      await verifyBalanceSum(store.options.address, finalFee, halfDefaultBond);
    });
  });

  describe("Callbacks", function () {
    beforeEach(async function () {
      // Caller must post reward + proposal bond.
      const totalStake = toBN(reward).add(toBN(totalDefaultBond)).toString();
      await collateral.methods.transfer(optimisticRequester.options.address, totalStake).send({ from: accounts[0] });
    });
    describe("Verify propose callback", function () {
      it("Returns data to requesting contract", async function () {
        await optimisticRequester.methods
          .requestAndProposePriceFor(
            identifier,
            requestTime,
            "0x01",
            collateral.options.address,
            reward,
            finalFee,
            0,
            proposer,
            correctPrice
          )
          .send({ from: requester });

        assert.equal(hexToUtf8(await optimisticRequester.methods.identifier().call()), hexToUtf8(identifier));
        assert.equal((await optimisticRequester.methods.timestamp().call()).toString(), requestTime.toString());
        assert.equal((await optimisticRequester.methods.ancillaryData().call()).toString(), "0x01");
        const savedRequest = await optimisticRequester.methods.request().call();
        assert.isTrue(
          savedRequest.proposer === proposer &&
            savedRequest.disputer === ZERO_ADDRESS &&
            savedRequest.currency === collateral.options.address &&
            !savedRequest.settled &&
            savedRequest.proposedPrice === correctPrice &&
            savedRequest.resolvedPrice === "0" &&
            savedRequest.expirationTime === defaultExpiryTime.toString() &&
            savedRequest.reward === reward &&
            savedRequest.bond === finalFee &&
            savedRequest.finalFee === finalFee &&
            savedRequest.customLiveness === "0"
        );
      });
      it("Reverting callback implementation does not cause dispute to revert", async function () {
        await optimisticRequester.methods.setRevert(true).send({ from: accounts[0] });
        assert.ok(
          await optimisticRequester.methods
            .requestAndProposePriceFor(
              identifier,
              requestTime,
              "0x01",
              collateral.options.address,
              reward,
              finalFee,
              0,
              proposer,
              correctPrice
            )
            .send({ from: requester })
        );
      });
    });
    describe("Verify dispute callback", function () {
      beforeEach(async function () {
        await optimisticRequester.methods
          .requestAndProposePriceFor(
            identifier,
            requestTime,
            "0x01",
            collateral.options.address,
            reward,
            finalFee,
            0,
            proposer,
            correctPrice
          )
          .send({ from: requester });
        await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      });
      it("Returns data to requesting contract", async function () {
        await optimisticOracle.methods
          .disputePrice(
            optimisticRequester.options.address,
            identifier,
            requestTime,
            "0x01",
            postProposalParams(requestParams)
          )
          .send({ from: disputer });

        assert.equal(hexToUtf8(await optimisticRequester.methods.identifier().call()), hexToUtf8(identifier));
        assert.equal((await optimisticRequester.methods.timestamp().call()).toString(), requestTime.toString());
        assert.equal((await optimisticRequester.methods.ancillaryData().call()).toString(), "0x01");
        const savedRequest = await optimisticRequester.methods.request().call();
        assert.isTrue(
          savedRequest.proposer === proposer &&
            savedRequest.disputer === disputer &&
            savedRequest.currency === collateral.options.address &&
            !savedRequest.settled &&
            savedRequest.proposedPrice === correctPrice &&
            savedRequest.resolvedPrice === "0" &&
            savedRequest.expirationTime === defaultExpiryTime.toString() &&
            savedRequest.reward === reward &&
            savedRequest.bond === finalFee &&
            savedRequest.finalFee === finalFee &&
            savedRequest.customLiveness === "0"
        );
      });
      it("Reverting callback implementation does not cause dispute to revert", async function () {
        await optimisticRequester.methods.setRevert(true).send({ from: accounts[0] });
        assert.ok(
          await optimisticOracle.methods
            .disputePrice(
              optimisticRequester.options.address,
              identifier,
              requestTime,
              "0x01",
              postProposalParams(requestParams)
            )
            .send({ from: disputer })
        );
      });
    });

    describe("Verify settle callback", function () {
      beforeEach(async function () {
        await optimisticRequester.methods
          .requestAndProposePriceFor(
            identifier,
            requestTime,
            "0x01",
            collateral.options.address,
            reward,
            finalFee,
            0,
            proposer,
            correctPrice
          )
          .send({ from: requester });
        await optimisticOracle.methods.setCurrentTime(defaultExpiryTime).send({ from: accounts[0] });
      });
      it("Returns data to requesting contract", async function () {
        await optimisticOracle.methods
          .settle(
            optimisticRequester.options.address,
            identifier,
            requestTime,
            "0x01",
            postProposalParams(requestParams)
          )
          .send({ from: accounts[0] });

        assert.equal(hexToUtf8(await optimisticRequester.methods.identifier().call()), hexToUtf8(identifier));
        assert.equal((await optimisticRequester.methods.timestamp().call()).toString(), requestTime.toString());
        assert.equal((await optimisticRequester.methods.ancillaryData().call()).toString(), "0x01");
        const savedRequest = await optimisticRequester.methods.request().call();
        assert.isTrue(
          savedRequest.proposer === proposer &&
            savedRequest.disputer === ZERO_ADDRESS &&
            savedRequest.currency === collateral.options.address &&
            savedRequest.settled &&
            savedRequest.proposedPrice === correctPrice &&
            savedRequest.resolvedPrice === correctPrice &&
            savedRequest.expirationTime === defaultExpiryTime.toString() &&
            savedRequest.reward === reward &&
            savedRequest.bond === finalFee &&
            savedRequest.finalFee === finalFee &&
            savedRequest.customLiveness === "0"
        );
      });
      it("Reverting callback implementation does not cause dispute to revert", async function () {
        await optimisticRequester.methods.setRevert(true).send({ from: accounts[0] });
        assert.ok(
          await optimisticOracle.methods
            .settle(
              optimisticRequester.options.address,
              identifier,
              requestTime,
              "0x01",
              postProposalParams(requestParams)
            )
            .send({ from: accounts[0] })
        );
      });
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
      await verifyState(OptimisticOracleRequestStatesEnum.INVALID, requester, identifier, requestTime, ancillaryData, {
        ...requestParams,
        currency: ZERO_ADDRESS,
      });

      // Requested.
      await collateral.methods.transfer(requester, reward).send({ from: accounts[0] });
      await collateral.methods.increaseAllowance(optimisticOracle.options.address, reward).send({ from: requester });
      await optimisticOracle.methods
        .requestPrice(identifier, requestTime, ancillaryData, collateral.options.address, reward, 0, 0)
        .send({ from: requester });
      await verifyState(
        OptimisticOracleRequestStatesEnum.REQUESTED,
        requester,
        identifier,
        requestTime,
        ancillaryData,
        requestParams
      );

      // Proposed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(requester, identifier, requestTime, ancillaryData, requestParams, incorrectPrice)
        .send({ from: proposer });
      await verifyState(
        OptimisticOracleRequestStatesEnum.PROPOSED,
        requester,
        identifier,
        requestTime,
        ancillaryData,
        postProposalParams(requestParams, defaultExpiryTime, incorrectPrice)
      );

      // Disputed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(
          requester,
          identifier,
          requestTime,
          ancillaryData,
          postProposalParams(requestParams, defaultExpiryTime, incorrectPrice)
        )
        .send({ from: disputer });
      await verifyState(
        OptimisticOracleRequestStatesEnum.DISPUTED,
        requester,
        identifier,
        requestTime,
        ancillaryData,
        postDisputeParams(postProposalParams(requestParams, defaultExpiryTime, incorrectPrice))
      );

      // Check that OptimisticOracle stamped ancillary data as expected before sending to Oracle, and that we can decode
      // it.
      const priceRequests = await mockOracle.getPastEvents("PriceRequestAdded", { fromBlock: 0 });
      assert.equal(priceRequests.length, 1, "should only be one price request escalated to MockOracle");
      const stampedAncillaryData = priceRequests[0].returnValues.ancillaryData;
      assert.equal(
        hexToUtf8(stampedAncillaryData),
        `${hexToUtf8(ancillaryData)},ooRequester:${requester.substr(2).toLowerCase()}`
      );

      // Settled
      await pushPrice(correctPrice);
      await optimisticOracle.methods
        .settle(
          requester,
          identifier,
          requestTime,
          ancillaryData,
          postDisputeParams(postProposalParams(requestParams, defaultExpiryTime, incorrectPrice))
        )
        .send({ from: accounts[0] });
      await verifyState(
        OptimisticOracleRequestStatesEnum.SETTLED,
        requester,
        identifier,
        requestTime,
        ancillaryData,
        postSettleExpiryParams(postDisputeParams(postProposalParams(requestParams, defaultExpiryTime, incorrectPrice)))
      );
    });

    it("Original ancillary data is empty", async function () {
      const ancillaryData = utf8ToHex("");

      // Requested.
      await collateral.methods.transfer(requester, reward).send({ from: accounts[0] });
      await collateral.methods.increaseAllowance(optimisticOracle.options.address, reward).send({ from: requester });
      await optimisticOracle.methods
        .requestPrice(identifier, requestTime, ancillaryData, collateral.options.address, reward, 0, 0)
        .send({ from: requester });

      // Proposed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(requester, identifier, requestTime, ancillaryData, requestParams, incorrectPrice)
        .send({ from: proposer });

      // Disputed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(
          requester,
          identifier,
          requestTime,
          ancillaryData,
          postProposalParams(requestParams, defaultExpiryTime, incorrectPrice)
        )
        .send({ from: disputer });

      // Check that OptimisticOracle stamped ancillary data as expected before sending to Oracle, and that we can decode
      // it.
      const priceRequests = await mockOracle.getPastEvents("PriceRequestAdded", { fromBlock: 0 });
      assert.equal(priceRequests.length, 1, "should only be one price request escalated to MockOracle");
      const stampedAncillaryData = priceRequests[0].returnValues.ancillaryData;
      assert.equal(
        hexToUtf8(stampedAncillaryData),
        `ooRequester:${requester.substr(2).toLowerCase()}`,
        "Should not stamp with a leading comma ','"
      );
    });

    it("Original ancillary data is not UTF8-encodeable", async function () {
      const ancillaryData = "0xabcd";

      // Requested.
      await collateral.methods.transfer(requester, reward).send({ from: accounts[0] });
      await collateral.methods.increaseAllowance(optimisticOracle.options.address, reward).send({ from: requester });
      await optimisticOracle.methods
        .requestPrice(identifier, requestTime, ancillaryData, collateral.options.address, reward, 0, 0)
        .send({ from: requester });

      // Proposed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: proposer });
      await optimisticOracle.methods
        .proposePrice(requester, identifier, requestTime, ancillaryData, requestParams, incorrectPrice)
        .send({ from: proposer });

      // Disputed.
      await collateral.methods.approve(optimisticOracle.options.address, totalDefaultBond).send({ from: disputer });
      await optimisticOracle.methods
        .disputePrice(
          requester,
          identifier,
          requestTime,
          ancillaryData,
          postProposalParams(requestParams, defaultExpiryTime, incorrectPrice)
        )
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
        `,ooRequester:${requester.substr(2).toLowerCase()}`,
        "Should be able to decode trailing stamped component of ancillary data"
      );
    });

    it("Stress testing the size of ancillary data", async function () {
      // Requested.
      await collateral.methods.transfer(requester, reward).send({ from: accounts[0] });
      await collateral.methods.increaseAllowance(optimisticOracle.options.address, reward).send({ from: requester });
      assert(
        await didContractThrow(
          optimisticOracle.methods
            .requestPrice(
              identifier,
              requestTime,
              web3.utils.randomHex(MAX_ANCILLARY_DATA_LENGTH + 1),
              collateral.options.address,
              reward,
              0,
              0
            )
            .send({ from: requester })
        )
      );

      // Show ancillary succeeds if you don't add 1 byte:
      await optimisticOracle.methods
        .requestPrice(
          identifier,
          requestTime,
          web3.utils.randomHex(MAX_ANCILLARY_DATA_LENGTH),
          collateral.options.address,
          reward,
          0,
          0
        )
        .send({ from: requester });
    });
  });
});
