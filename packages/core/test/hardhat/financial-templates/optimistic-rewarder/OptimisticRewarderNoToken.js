const { assert } = require("chai");
const hre = require("hardhat");
const { web3, getContract, findEvent } = hre;
const { didContractThrow, interfaceName, runDefaultFixture, TokenRolesEnum, ZERO_ADDRESS } = require("@uma/common");
const { utf8ToHex, toWei, toBN } = web3.utils;

// Tested contracts
const OptimisticRewarder = getContract("OptimisticRewarderTest");
const OptimisticRewarderNoToken = getContract("OptimisticRewarderNoTokenTest");

// Helper contracts
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const AddressWhitelist = getContract("AddressWhitelist");
const MockOracle = getContract("MockOracleAncillary");
const Timer = getContract("Timer");
const Store = getContract("Store");
const ERC20 = getContract("ExpandedERC20");
const ERC721 = getContract("MintableERC721");

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

describe("OptimisticRewarderNoToken", () => {
  let accounts, owner, submitter, disputer, tokenUpdater;

  let timer, finder, collateralWhitelist, store, identifierWhitelist, bondToken, mockOracle;

  const advanceTime = async (timeIncrease) => {
    await timer.methods
      .setCurrentTime(Number(await timer.methods.getCurrentTime().call()) + timeIncrease)
      .send({ from: owner });
  };

  const getTokenId = async (receipt, contract) => {
    return (await findEvent(receipt, contract, "Transfer", (event) => event.from === ZERO_ADDRESS)).match?.returnValues
      ?.tokenId;
  };

  const mint = async (token, recipient, amount) => {
    if (!(await token.methods.holdsRole(TokenRolesEnum.MINTER, owner).call())) {
      await token.methods.addMember(TokenRolesEnum.MINTER, owner).send({ from: owner });
    }

    await token.methods.mint(recipient, amount).send({ from: owner });
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
  });

  it("Simple lifecycle using migrated OptimisticRewarder", async function () {
    const initialOptimisticRewarder = await OptimisticRewarder.new(
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

    const optimisticRewarder = await OptimisticRewarderNoToken.new(
      initialOptimisticRewarder.options.address,
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

    // Mint a token using the standard mint method that emits an UpdateToken event.
    let receipt = await optimisticRewarder.methods.mint(submitter, updateData).send({ from: tokenUpdater });
    const tokenId = await getTokenId(receipt, initialOptimisticRewarder);

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
    await optimisticRewarder.methods.requestRedemption(tokenId, redemptions).send({ from: submitter });
    await advanceTime(liveness);

    // Can't dispute after liveness.
    assert(await didContractThrow(optimisticRewarder.methods.dispute(tokenId, redemptions).send({ from: disputer })));

    // Redeem.
    await optimisticRewarder.methods.redeem(tokenId, redemptions).send({ from: submitter });

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

  it("Simple lifecycle using standard ERC721", async function () {
    const erc721 = await ERC721.new(name, symbol).send({ from: owner });

    const optimisticRewarder = await OptimisticRewarderNoToken.new(
      erc721.options.address,
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

    // Mint a token using the standard mint method that emits an UpdateToken event.
    assert(await didContractThrow(optimisticRewarder.methods.mint(submitter, updateData).send({ from: tokenUpdater })));
    const tokenId = "0";
    await erc721.methods.mint(submitter, tokenId).send({ from: submitter });

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
    await optimisticRewarder.methods.requestRedemption(tokenId, redemptions).send({ from: submitter });
    await advanceTime(liveness);

    // Can't dispute after liveness.
    assert(await didContractThrow(optimisticRewarder.methods.dispute(tokenId, redemptions).send({ from: disputer })));

    // Redeem.
    await optimisticRewarder.methods.redeem(tokenId, redemptions).send({ from: submitter });

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
});
