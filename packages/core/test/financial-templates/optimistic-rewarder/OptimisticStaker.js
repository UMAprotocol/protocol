const { assert } = require("chai");
const hre = require("hardhat");
const { web3, getContract, assertEventEmitted, findEvent } = hre;
const { didContractThrow, runDefaultFixture, TokenRolesEnum, ZERO_ADDRESS } = require("@uma/common");
const { utf8ToHex, toWei, toBN } = web3.utils;

// Tested contracts
const OptimisticRewarder = getContract("OptimisticRewarderTest");
const OptimisticStaker = getContract("OptimisticStaker");

// Helper contracts
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
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
const stakedAmount = toWei("1000");

describe("OptimisticRewarder", () => {
  let accounts, owner, staker;

  let timer,
    finder,
    collateralWhitelist,
    store,
    identifierWhitelist,
    bondToken,
    optimisticRewarder,
    optimisticStaker,
    stakedToken;

  const getTokenId = async (receipt, contract = optimisticRewarder) => {
    return (await findEvent(receipt, contract, "Transfer", (event) => event.from === ZERO_ADDRESS)).match?.returnValues
      ?.tokenId;
  };

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner, staker] = accounts;

    await runDefaultFixture(hre);

    timer = await Timer.deployed();
    finder = await Finder.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    store = await Store.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();

    await identifierWhitelist.methods.addSupportedIdentifier(identifier).send({ from: owner });
  });
  beforeEach(async function () {
    // Deploy new contracts with clean state and perform setup:
    bondToken = await ERC20.new("BOND", "BOND", 18).send({ from: owner });
    await bondToken.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });
    await collateralWhitelist.methods.addToWhitelist(bondToken.options.address).send({ from: owner });
    await store.methods.setFinalFee(bondToken.options.address, { rawValue: finalFee }).send({ from: owner });
    stakedToken = await ERC20.new("STAKE", "STAKE", 18).send({ from: owner });
    await stakedToken.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });
    await stakedToken.methods.mint(staker, stakedAmount).send({ from: owner });
    await stakedToken.methods.mint(owner, stakedAmount).send({ from: owner });

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

    optimisticStaker = await OptimisticStaker.new(
      optimisticRewarder.options.address,
      stakedToken.options.address
    ).send({ from: owner });

    await stakedToken.methods.approve(optimisticStaker.options.address, stakedAmount).send({ from: staker });
    await stakedToken.methods.approve(optimisticStaker.options.address, stakedAmount).send({ from: owner });
  });
  it("Simple new token stake and withdraw", async function () {
    let txn = optimisticStaker.methods.depositNew(stakedAmount);
    let receipt = await txn.send({ from: staker });
    const tokenId = await getTokenId(receipt);

    await assertEventEmitted(
      receipt,
      optimisticRewarder,
      "UpdateToken",
      (event) =>
        event.data === txn.encodeABI() && event.tokenId === tokenId && event.caller === optimisticStaker.options.address
    );

    await assertEventEmitted(
      receipt,
      optimisticStaker,
      "Deposit",
      (event) => event.tokenId === tokenId && event.amount === stakedAmount
    );

    txn = optimisticStaker.methods.withdraw(tokenId, stakedAmount);

    // Owner doesn't have permission.
    assert(await didContractThrow(txn.send({ from: owner })));

    // Check receipt for event.
    receipt = await txn.send({ from: staker });

    await assertEventEmitted(
      receipt,
      optimisticRewarder,
      "UpdateToken",
      (event) =>
        event.data === txn.encodeABI() && event.tokenId === tokenId && event.caller === optimisticStaker.options.address
    );

    await assertEventEmitted(
      receipt,
      optimisticStaker,
      "Withdraw",
      (event) => event.tokenId === tokenId && event.amount === stakedAmount
    );

    // Cannot withdraw more.
    assert(await didContractThrow(txn.send({ from: staker })));

    assert.equal(await stakedToken.methods.balanceOf(staker).call(), stakedAmount);
  });

  it("Deposit/DepositFor stake and withdraw", async function () {
    // Mint token beforehand.
    let receipt = await optimisticRewarder.methods.mintNextToken(staker).send({ from: staker });
    const tokenId = await getTokenId(receipt);

    // Cannot call deposit on token you don't own.
    assert(await didContractThrow(optimisticStaker.methods.deposit(tokenId, stakedAmount).send({ from: owner })));

    // Can call depositFor for a token you don't own.
    await optimisticStaker.methods.depositFor(tokenId, stakedAmount).send({ from: owner });

    // Call regular deposit on an exogenously created token.
    await optimisticStaker.methods.deposit(tokenId, stakedAmount).send({ from: staker });

    const totalAmount = toBN(stakedAmount).muln(2).toString();

    // Only owner of the token can withdraw.
    assert(await didContractThrow(optimisticStaker.methods.withdraw(tokenId, totalAmount).send({ from: owner })));
    await optimisticRewarder.methods.safeTransferFrom(staker, owner, tokenId).send({ from: staker });
    assert(await didContractThrow(optimisticStaker.methods.withdraw(tokenId, totalAmount).send({ from: staker })));

    await optimisticStaker.methods.withdraw(tokenId, totalAmount).send({ from: owner });
    assert.equal(await stakedToken.methods.balanceOf(owner).call(), totalAmount);
  });

  it("Cannot withdraw others' money", async function () {
    // Mint tokens beforehand.
    let receipt = await optimisticRewarder.methods.mintNextToken(staker).send({ from: staker });
    const stakerTokenId = await getTokenId(receipt);

    receipt = await optimisticRewarder.methods.mintNextToken(owner).send({ from: owner });
    const ownerTokenId = await getTokenId(receipt);

    await optimisticStaker.methods.deposit(stakerTokenId, stakedAmount).send({ from: staker });
    await optimisticStaker.methods.deposit(ownerTokenId, stakedAmount).send({ from: owner });

    assert(
      await didContractThrow(
        optimisticStaker.methods.withdraw(ownerTokenId, toBN(stakedAmount).addn(1).toString()).send({ from: owner })
      )
    );
    await optimisticStaker.methods.withdraw(ownerTokenId, stakedAmount).send({ from: owner });
  });
});
