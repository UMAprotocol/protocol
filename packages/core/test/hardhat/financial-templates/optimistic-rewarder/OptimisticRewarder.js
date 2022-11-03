const { assert } = require("chai");
const hre = require("hardhat");
const { web3, getContract, assertEventEmitted, findEvent } = hre;
const { didContractThrow, interfaceName, runDefaultFixture, TokenRolesEnum, ZERO_ADDRESS } = require("@uma/common");
const { utf8ToHex, toWei, randomHex, toBN, toChecksumAddress } = web3.utils;

// Tested contracts
const OptimisticRewarder = getContract("OptimisticRewarderTest");

// Helper contracts
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const OptimisticOracle = getContract("SkinnyOptimisticOracle");
const MockOracle = getContract("MockOracleAncillary");
const Timer = getContract("Timer");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");

const finalFee = toWei("100");
const name = "TestName";
const symbol = "TST";
const baseUri = "Base URI";
const liveness = 7200;
const bond = toWei("500");
const identifier = utf8ToHex("TESTID");
const customAncillaryData = utf8ToHex("ABC123");
const updateData = utf8ToHex("UPDATEDATA");
const totalBond = toBN(finalFee).add(toBN(bond)).toString();

describe("OptimisticRewarder", () => {
  let accounts, owner, submitter, disputer, tokenUpdater;

  let timer,
    finder,
    collateralWhitelist,
    store,
    identifierWhitelist,
    bondToken,
    mockOracle,
    optimisticRewarder,
    optimisticOracle;

  const advanceTime = async (timeIncrease) => {
    await timer.methods
      .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + timeIncrease)
      .send({ from: owner });
  };

  const getTokenId = async (receipt, contract = optimisticRewarder) => {
    return (await findEvent(receipt, contract, "Transfer", (event) => event.from === ZERO_ADDRESS)).match?.returnValues
      ?.tokenId;
  };

  const getRedemptionId = async (receipt, contract = optimisticRewarder) => {
    return (await findEvent(receipt, contract, "Requested")).match?.returnValues?.redemptionId;
  };

  const mint = async (token, recipient, amount) => {
    if (!(await token.methods.holdsRole(TokenRolesEnum.MINTER, owner).call())) {
      await token.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });
    }

    await token.methods.mint(recipient, amount).send({ from: owner });
  };

  const areCumulativeRedemptionsEqual = (a, b) => {
    return a.every(
      (element, index) =>
        toChecksumAddress(element.token) === toChecksumAddress(b[index].token) &&
        element.amount.toString() === b[index].amount.toString()
    );
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, submitter, disputer, tokenUpdater] = accounts;

    await runDefaultFixture(hre);

    timer = await Timer.deployed();
    finder = await Finder.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    store = await Store.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    optimisticOracle = await OptimisticOracle.deployed();

    // Deploy new MockOracle so that OptimisticOracle disputes can make price requests to it:
    mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Oracle), mockOracle.options.address)
      .send({ from: owner });
    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: owner });
  });
  beforeEach(async function () {
    // Deploy new contracts with clean state and perform setup:
    bondToken = await ERC20.new("BOND", "BOND", 18).send({ from: owner });
    await bondToken.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });
    await collateralWhitelist.methods.addToWhitelist(bondToken.options.address).send({ from: owner });
    await store.methods.setFinalFee(bondToken.options.address, { rawValue: finalFee }).send({ from: owner });

    optimisticRewarder = await OptimisticRewarder.new(
      name,
      symbol,
      baseUri,
      liveness,
      bondToken.options.address,
      bond,
      identifier,
      customAncillaryData,
      finder.options.address,
      timer.options.address
    ).send({ from: owner });

    await bondToken.methods.mint(submitter, totalBond).send({ from: owner });
    await bondToken.methods.approve(optimisticRewarder.options.address, totalBond).send({ from: submitter });
    await bondToken.methods.mint(disputer, totalBond).send({ from: owner });
    await bondToken.methods.approve(optimisticRewarder.options.address, totalBond).send({ from: disputer });
  });
  it("Constructor validation", async function () {
    // 0 liveness.
    assert(
      await didContractThrow(
        OptimisticRewarder.new(
          name,
          symbol,
          baseUri,
          0,
          bondToken.options.address,
          bond,
          identifier,
          customAncillaryData,
          finder.options.address,
          timer.options.address
        ).send({ from: owner })
      )
    );

    // Unapproved token.
    assert(
      await didContractThrow(
        OptimisticRewarder.new(
          name,
          symbol,
          baseUri,
          liveness,
          (await ERC20.new("BOND", "BOND", 18).send({ from: owner })).options.address,
          bond,
          identifier,
          customAncillaryData,
          finder.options.address,
          timer.options.address
        ).send({ from: owner })
      )
    );

    // Unapproved identifier.
    assert(
      await didContractThrow(
        OptimisticRewarder.new(
          name,
          symbol,
          baseUri,
          liveness,
          bondToken.options.address,
          bond,
          utf8ToHex("Unapproved"),
          customAncillaryData,
          finder.options.address,
          timer.options.address
        ).send({ from: owner })
      )
    );

    // Ancillary data too long (should fail with the additions added by the contract)
    assert(
      await didContractThrow(
        OptimisticRewarder.new(
          name,
          symbol,
          baseUri,
          liveness,
          bondToken.options.address,
          bond,
          identifier,
          randomHex(8191),
          finder.options.address,
          timer.options.address
        ).send({ from: owner })
      )
    );
  });
  it("Basic Minting and Updating", async function () {
    // Mint a token using the standard mint method that emits an UpdateToken event.
    let receipt = await optimisticRewarder.methods.mint(submitter, updateData).send({ from: tokenUpdater });
    let tokenId = await getTokenId(receipt);
    await assertEventEmitted(
      receipt,
      optimisticRewarder,
      "UpdateToken",
      (event) => event.tokenId === tokenId && event.caller === tokenUpdater && event.data === updateData
    );

    // Mint the token by calling the mintNextToken method directly and verify the updateToken method still works as
    // expected.
    receipt = await optimisticRewarder.methods.mintNextToken(submitter).send({ from: submitter });
    tokenId = await getTokenId(receipt);
    receipt = await optimisticRewarder.methods.updateToken(tokenId, updateData).send({ from: tokenUpdater });
    await assertEventEmitted(
      receipt,
      optimisticRewarder,
      "UpdateToken",
      (event) => event.tokenId === tokenId && event.caller === tokenUpdater && event.data === updateData
    );
  });

  it("Redemption lifecycle", async function () {
    // Mint a token using the standard mint method that emits an UpdateToken event.
    let receipt = await optimisticRewarder.methods.mint(submitter, updateData).send({ from: tokenUpdater });
    const tokenId = await getTokenId(receipt);

    // Create and mint tokens.
    const redemptionToken = await ERC20.new("Redemption", "REDEMPTION", 18).send({ from: owner });
    await mint(redemptionToken, owner, toWei("150"));
    await redemptionToken.methods.approve(optimisticRewarder.options.address, toWei("150")).send({ from: owner });

    // Deposit tokens
    await optimisticRewarder.methods
      .depositRewards(redemptionToken.options.address, toWei("150"))
      .send({ from: owner });

    // Submit redemption
    const redemptions = [{ token: redemptionToken.options.address, amount: toWei("100") }];
    receipt = await optimisticRewarder.methods.requestRedemption(tokenId, redemptions).send({ from: submitter });
    const expiryTime = parseInt(await optimisticRewarder.methods.getCurrentTime().call()) + liveness;
    await assertEventEmitted(
      receipt,
      optimisticRewarder,
      "Requested",
      (event) =>
        event.tokenId === tokenId &&
        areCumulativeRedemptionsEqual(event.cumulativeRedemptions, redemptions) &&
        event.expiryTime.toString() === expiryTime.toString()
    );
    const redemptionId = await getRedemptionId(receipt);
    await advanceTime(liveness);

    // Can't dispute after liveness.
    assert(await didContractThrow(optimisticRewarder.methods.dispute(tokenId, redemptions).send({ from: disputer })));

    // Redeem.
    receipt = await optimisticRewarder.methods.redeem(tokenId, redemptions).send({ from: submitter });
    await assertEventEmitted(
      receipt,
      optimisticRewarder,
      "Redeemed",
      (event) =>
        event.tokenId === tokenId &&
        event.redemptionId === redemptionId &&
        event.expiryTime.toString() === expiryTime.toString()
    );

    // Repeat redemption not allowed.
    assert(await didContractThrow(optimisticRewarder.methods.redeem(tokenId, redemptions).send({ from: submitter })));

    // Cannot redeem unrequested redemption.
    assert(
      await didContractThrow(
        optimisticRewarder.methods
          .redeem(tokenId, [{ token: redemptionToken.options.address, amount: toWei("50") }])
          .send({ from: submitter })
      )
    );

    assert.equal(await redemptionToken.methods.balanceOf(submitter).call(), toWei("100"));
    assert.equal(await bondToken.methods.balanceOf(submitter).call(), totalBond);
  });

  it("Redemption checks", async function () {
    // Mint a token using the standard mint method that emits an UpdateToken event.
    let receipt = await optimisticRewarder.methods.mint(submitter, updateData).send({ from: tokenUpdater });
    const tokenId = await getTokenId(receipt);

    // Double redemption
    const repeatRedemptions = [{ token: randomHex(20), amount: toWei("100") }];
    await optimisticRewarder.methods.requestRedemption(tokenId, repeatRedemptions).send({ from: submitter });
    assert(
      await didContractThrow(
        optimisticRewarder.methods.requestRedemption(tokenId, repeatRedemptions).send({ from: submitter })
      )
    );

    // Invalid token
    const redemption = [{ token: randomHex(20), amount: toWei("100") }];
    assert(
      await didContractThrow(
        optimisticRewarder.methods.requestRedemption(Number(tokenId) + 1, redemption).send({ from: submitter })
      )
    );

    // Too many redemptions
    const manyRedemptions = [];
    for (let i = 0; i < 101; i++) manyRedemptions.push({ token: randomHex(20), amount: toWei("100") });
    assert(
      await didContractThrow(
        optimisticRewarder.methods.requestRedemption(tokenId, manyRedemptions).send({ from: submitter })
      )
    );
  });

  it("Multi token redemption", async function () {
    // Mint a token using the standard mint method that emits an UpdateToken event.
    let receipt = await optimisticRewarder.methods.mint(submitter, updateData).send({ from: tokenUpdater });
    const tokenId = await getTokenId(receipt);

    // Create and mint tokens.
    const redemptionToken1 = await ERC20.new("Redemption", "REDEMPTION", 18).send({ from: owner });
    await mint(redemptionToken1, owner, toWei("100"));
    await redemptionToken1.methods.approve(optimisticRewarder.options.address, toWei("100")).send({ from: owner });
    const redemptionToken2 = await ERC20.new("Redemption", "REDEMPTION", 18).send({ from: owner });
    await mint(redemptionToken2, owner, toWei("100"));
    await redemptionToken2.methods.approve(optimisticRewarder.options.address, toWei("100")).send({ from: owner });

    // Deposit tokens
    await optimisticRewarder.methods
      .depositRewards(redemptionToken1.options.address, toWei("100"))
      .send({ from: owner });
    await optimisticRewarder.methods
      .depositRewards(redemptionToken2.options.address, toWei("100"))
      .send({ from: owner });

    // Submit redemption
    const redemptions = [
      { token: redemptionToken1.options.address, amount: toWei("100") },
      { token: redemptionToken2.options.address, amount: toWei("100") },
    ];
    await optimisticRewarder.methods.requestRedemption(tokenId, redemptions).send({ from: submitter });
    await advanceTime(liveness);

    // Redeem.
    await optimisticRewarder.methods.redeem(tokenId, redemptions).send({ from: submitter });

    assert.equal(await redemptionToken1.methods.balanceOf(submitter).call(), toWei("100"));
    assert.equal(await redemptionToken2.methods.balanceOf(submitter).call(), toWei("100"));
  });

  it("Multiple redemptions", async function () {
    // Mint a token using the standard mint method that emits an UpdateToken event.
    let receipt = await optimisticRewarder.methods.mint(submitter, updateData).send({ from: tokenUpdater });
    const tokenId = await getTokenId(receipt);

    // Create and mint tokens.
    const redemptionToken = await ERC20.new("Redemption", "REDEMPTION", 18).send({ from: owner });
    await mint(redemptionToken, owner, toWei("150"));
    await redemptionToken.methods.approve(optimisticRewarder.options.address, toWei("150")).send({ from: owner });

    // Deposit tokens
    await optimisticRewarder.methods
      .depositRewards(redemptionToken.options.address, toWei("150"))
      .send({ from: owner });

    // Mint and approve for 3 redemption bonds.
    await mint(bondToken, submitter, toBN(totalBond).muln(2).toString());
    await bondToken.methods
      .approve(optimisticRewarder.options.address, toBN(totalBond).muln(3).toString())
      .send({ from: submitter });

    // Submit three redemptions redemption
    await optimisticRewarder.methods
      .requestRedemption(tokenId, [{ token: redemptionToken.options.address, amount: toWei("50") }])
      .send({ from: submitter });
    await optimisticRewarder.methods
      .requestRedemption(tokenId, [{ token: redemptionToken.options.address, amount: toWei("100") }])
      .send({ from: submitter });
    await optimisticRewarder.methods
      .requestRedemption(tokenId, [{ token: redemptionToken.options.address, amount: toWei("150") }])
      .send({ from: submitter });
    await advanceTime(liveness);

    // Redeem 100 first.
    await optimisticRewarder.methods
      .redeem(tokenId, [{ token: redemptionToken.options.address, amount: toWei("100") }])
      .send({ from: submitter });
    assert.equal(await redemptionToken.methods.balanceOf(submitter).call(), toWei("100"));

    // Redeem 50. Because the cumulative redemptions are already higher than 50, no balance change should occcur.
    await optimisticRewarder.methods
      .redeem(tokenId, [{ token: redemptionToken.options.address, amount: toWei("50") }])
      .send({ from: submitter });
    assert.equal(await redemptionToken.methods.balanceOf(submitter).call(), toWei("100"));

    // Redeem 150. Should pay out the difference: 50.
    await optimisticRewarder.methods
      .redeem(tokenId, [{ token: redemptionToken.options.address, amount: toWei("150") }])
      .send({ from: submitter });
    assert.equal(await redemptionToken.methods.balanceOf(submitter).call(), toWei("150"));
  });

  it("Basic dispute lifecycle (invalid dispute)", async function () {
    // Mint a token using the standard mint method that emits an UpdateToken event.
    let receipt = await optimisticRewarder.methods.mint(submitter, updateData).send({ from: tokenUpdater });
    const tokenId = await getTokenId(receipt);

    // Create and mint tokens.
    const redemptionToken = await ERC20.new("Redemption", "REDEMPTION", 18).send({ from: owner });
    await mint(redemptionToken, owner, toWei("150"));
    await redemptionToken.methods.approve(optimisticRewarder.options.address, toWei("150")).send({ from: owner });

    // Deposit tokens
    await optimisticRewarder.methods
      .depositRewards(redemptionToken.options.address, toWei("150"))
      .send({ from: owner });

    // Submit redemption
    const redemptions = [{ token: redemptionToken.options.address, amount: toWei("100") }];
    assert(await didContractThrow(optimisticRewarder.methods.dispute(tokenId, redemptions).send({ from: disputer })));
    await optimisticRewarder.methods.requestRedemption(tokenId, redemptions).send({ from: submitter });
    const expirationTime = parseInt(await optimisticRewarder.methods.getCurrentTime().call()) + liveness;

    // Add 100 seconds to the current time so the dispute occurs at a different time than the proposal.
    await advanceTime(100);

    const disputeReceipt = await optimisticRewarder.methods.dispute(tokenId, redemptions).send({ from: disputer });
    const { request, timestamp, ancillaryData } = (
      await findEvent(disputeReceipt, optimisticOracle, "DisputePrice")
    ).match.returnValues;
    await assertEventEmitted(
      disputeReceipt,
      optimisticRewarder,
      "Disputed",
      (event) => event.tokenId === tokenId && expirationTime.toString() === event.expiryTime.toString()
    );

    const [dvmRequest] = await mockOracle.methods.getPendingQueries().call();
    await mockOracle.methods
      .pushPrice(identifier, timestamp, dvmRequest.ancillaryData, toWei("1"))
      .send({ from: owner });

    await optimisticOracle.methods
      .settle(optimisticRewarder.options.address, identifier, timestamp, ancillaryData, request)
      .send({ from: submitter });

    // Submitter gets half of disputer's bond.
    assert.equal(await bondToken.methods.balanceOf(submitter).call(), toBN(bond).muln(3).divn(2).add(toBN(finalFee)));

    // Disputer gets nothing
    assert.equal(await bondToken.methods.balanceOf(disputer).call(), "0");

    // Can't redeem after a dispute.
    await advanceTime(7200);
    assert(await didContractThrow(optimisticRewarder.methods.redeem(tokenId, redemptions).send({ from: submitter })));

    // Can re-request
    await bondToken.methods.approve(optimisticRewarder.options.address, totalBond).send({ from: submitter });
    await optimisticRewarder.methods.requestRedemption(tokenId, redemptions).send({ from: submitter });
  });

  it("Final fee changes pre-dispute", async function () {
    // Mint a token using the standard mint method that emits an UpdateToken event.
    let receipt = await optimisticRewarder.methods.mint(submitter, updateData).send({ from: tokenUpdater });
    const tokenId = await getTokenId(receipt);

    // Create and mint tokens.
    const redemptionToken = await ERC20.new("Redemption", "REDEMPTION", 18).send({ from: owner });
    await mint(redemptionToken, owner, toWei("150"));
    await redemptionToken.methods.approve(optimisticRewarder.options.address, toWei("150")).send({ from: owner });

    // Deposit tokens
    await optimisticRewarder.methods
      .depositRewards(redemptionToken.options.address, toWei("150"))
      .send({ from: owner });

    // Submit redemption
    const redemptions = [{ token: redemptionToken.options.address, amount: toWei("100") }];
    assert(await didContractThrow(optimisticRewarder.methods.dispute(tokenId, redemptions).send({ from: disputer })));
    await optimisticRewarder.methods.requestRedemption(tokenId, redemptions).send({ from: submitter });
    await store.methods.setFinalFee(bondToken.options.address, { rawValue: toWei("1") }).send({ from: owner });

    // Add 100 seconds to the current time so the dispute occurs at a different time than the proposal.
    await advanceTime(100);

    receipt = await optimisticRewarder.methods.dispute(tokenId, redemptions).send({ from: disputer });
    await assertEventEmitted(receipt, optimisticRewarder, "Canceled");

    // Balances should match pre-request balances.
    assert.equal(await bondToken.methods.balanceOf(submitter).call(), totalBond);
    assert.equal(await bondToken.methods.balanceOf(disputer).call(), totalBond);

    // Cleanup
    await store.methods.setFinalFee(bondToken.options.address, { rawValue: finalFee }).send({ from: owner });
    await optimisticRewarder.methods.sync().send({ from: owner });
  });

  it("Optimistic oracle reverts on request", async function () {
    // Mint a token using the standard mint method that emits an UpdateToken event.
    let receipt = await optimisticRewarder.methods.mint(submitter, updateData).send({ from: tokenUpdater });
    const tokenId = await getTokenId(receipt);

    // Create and mint tokens.
    const redemptionToken = await ERC20.new("Redemption", "REDEMPTION", 18).send({ from: owner });
    await mint(redemptionToken, owner, toWei("150"));
    await redemptionToken.methods.approve(optimisticRewarder.options.address, toWei("150")).send({ from: owner });

    // Deposit tokens
    await optimisticRewarder.methods
      .depositRewards(redemptionToken.options.address, toWei("150"))
      .send({ from: owner });

    // Submit redemption
    const redemptions = [{ token: redemptionToken.options.address, amount: toWei("100") }];
    assert(await didContractThrow(optimisticRewarder.methods.dispute(tokenId, redemptions).send({ from: disputer })));
    await optimisticRewarder.methods.requestRedemption(tokenId, redemptions).send({ from: submitter });
    await collateralWhitelist.methods.removeFromWhitelist(bondToken.options.address).send({ from: owner });

    // Add 100 seconds to the current time so the dispute occurs at a different time than the proposal.
    await advanceTime(100);

    receipt = await optimisticRewarder.methods.dispute(tokenId, redemptions).send({ from: disputer });
    await assertEventEmitted(receipt, optimisticRewarder, "Canceled");

    // Balances should match pre-request balances.
    assert.equal(await bondToken.methods.balanceOf(submitter).call(), totalBond);
    assert.equal(await bondToken.methods.balanceOf(disputer).call(), totalBond);

    // Cleanup
    await collateralWhitelist.methods.addToWhitelist(bondToken.options.address).send({ from: owner });
  });

  it("Sync", async function () {
    const newOO = randomHex(20).toLowerCase();
    const newStore = await Store.new({ rawValue: "0" }, { rawValue: "0" }, timer.options.address).send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.SkinnyOptimisticOracle), newOO)
      .send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), newStore.options.address)
      .send({ from: owner });

    // Check that values haven't changed.
    assert.equal(await optimisticRewarder.methods.finalFee().call(), finalFee);
    assert.equal(await optimisticRewarder.methods.optimisticOracle().call(), optimisticOracle.options.address);
    assert.equal(await optimisticRewarder.methods.store().call(), store.options.address);

    // Call sync.
    await optimisticRewarder.methods.sync().send({ from: owner });

    // Check that values have updated.
    assert.equal(await optimisticRewarder.methods.finalFee().call(), "0");
    assert.equal((await optimisticRewarder.methods.optimisticOracle().call()).toLowerCase(), newOO);
    assert.equal(await optimisticRewarder.methods.store().call(), newStore.options.address);

    // Cleanup
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.SkinnyOptimisticOracle), optimisticOracle.options.address)
      .send({ from: owner });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.Store), store.options.address)
      .send({ from: owner });
  });
});
