const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { toWei, utf8ToHex, hexToUtf8 } = web3.utils;
const { assert } = require("chai");

// Libraries and helpers
const { interfaceName, didContractThrow, ZERO_ADDRESS } = require("@uma/common");

// Tested Contract
const LongShortPair = getContract("LongShortPair");
const LongShortPairCreator = getContract("LongShortPairCreator");
const LongShortPairFinancialProjectLibraryTest = getContract("LongShortPairFinancialProjectLibraryTest");

// Helper contracts
const AddressWhitelist = getContract("AddressWhitelist");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Finder = getContract("Finder");
const Timer = getContract("Timer");
const OptimisticOracle = getContract("OptimisticOracle");
const Token = getContract("ExpandedERC20");
const TokenFactory = getContract("TokenFactory");

let collateralToken;
let longShortPairLibrary;
let longShortPairCreator;
let collateralWhitelist;
let identifierWhitelist;
let optimisticOracle;
let finder;
let timer;
let constructorParams;

const startTimestamp = Math.floor(Date.now() / 1000);
const expirationTimestamp = startTimestamp + 10000;
const optimisticOracleLiveness = 7200;
const priceFeedIdentifier = utf8ToHex("TEST_IDENTIFIER");
const collateralPerPair = toWei("1"); // each pair of long and short tokens need 1 unit of collateral to mint.
const syntheticName = "Test LSP";
const syntheticSymbol = "tCFD";
const ancillaryData = web3.utils.utf8ToHex("some-address-field:0x1234");
const prepaidProposerReward = "0";

describe("LongShortPairCreator", function () {
  let accounts;
  let deployer;
  let sponsor;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [deployer, sponsor] = accounts;
    await runDefaultFixture(hre);
    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();
    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.methods.addSupportedIdentifier(priceFeedIdentifier).send({ from: deployer });
  });

  beforeEach(async function () {
    // Force each test to start with a simulated time that's synced to the startTimestamp.
    await timer.methods.setCurrentTime(startTimestamp).send({ from: accounts[0] });

    collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: deployer });
    await collateralToken.methods.addMember(1, deployer).send({ from: deployer });
    await collateralToken.methods.mint(sponsor, toWei("1000")).send({ from: deployer });

    await collateralWhitelist.methods.addToWhitelist(collateralToken.options.address).send({ from: accounts[0] });

    optimisticOracle = await OptimisticOracle.new(
      optimisticOracleLiveness,
      finder.options.address,
      timer.options.address
    ).send({ from: accounts[0] });
    await finder.methods
      .changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.options.address)
      .send({ from: deployer });

    longShortPairCreator = await LongShortPairCreator.new(
      finder.options.address,
      (await TokenFactory.deployed()).options.address,
      timer.options.address
    ).send({ from: accounts[0] });

    longShortPairLibrary = await LongShortPairFinancialProjectLibraryTest.new().send({ from: accounts[0] });

    // Define an object to easily re-use constructor params
    constructorParams = {
      expirationTimestamp,
      collateralPerPair,
      priceFeedIdentifier,
      syntheticName,
      syntheticSymbol,
      collateralAddress: collateralToken.options.address,
      financialProductLibraryAddress: longShortPairLibrary.options.address,
      ancillaryData,
      prepaidProposerReward,
    };
  });

  it("Can correctly create a LSP with valid params", async function () {
    // Can create a new LSP with the creator.
    const lspAddress = await longShortPairCreator.methods
      .createLongShortPair(...Object.values(constructorParams))
      .call();

    const lspCreateTx = await longShortPairCreator.methods
      .createLongShortPair(...Object.values(constructorParams))
      .send({ from: accounts[0] });

    // Event should be emitted correctly.
    await assertEventEmitted(lspCreateTx, longShortPairCreator, "CreatedLongShortPair", (ev) => {
      return ev.longShortPair == lspAddress && ev.deployerAddress == deployer;
    });

    // Validate LSP parameters are set correctly.
    const lsp = await LongShortPair.at(lspAddress);
    assert.equal(await lsp.methods.expirationTimestamp().call(), expirationTimestamp);
    assert.equal((await lsp.methods.collateralPerPair().call()).toString(), collateralPerPair.toString());
    assert.equal(hexToUtf8(await lsp.methods.priceIdentifier().call()), hexToUtf8(priceFeedIdentifier));
    assert.equal(await lsp.methods.collateralToken().call(), collateralToken.options.address);
    assert.equal(await lsp.methods.customAncillaryData().call(), ancillaryData);

    // Validate token information and permissions are set correctly.
    const longToken = await Token.at(await lsp.methods.longToken().call());
    assert.equal(await longToken.methods.name().call(), syntheticName + " Long Token");
    assert.equal(await longToken.methods.symbol().call(), "l" + syntheticSymbol);
    assert.equal(
      (await longToken.methods.decimals().call()).toString(),
      (await collateralToken.methods.decimals().call()).toString()
    );
    assert.isTrue(await longToken.methods.holdsRole("0", lspAddress).call());
    assert.isTrue(await longToken.methods.holdsRole("1", lspAddress).call());
    assert.isTrue(await longToken.methods.holdsRole("2", lspAddress).call());

    const shortToken = await Token.at(await lsp.methods.shortToken().call());
    assert.equal(await shortToken.methods.name().call(), syntheticName + " Short Token");
    assert.equal(await shortToken.methods.symbol().call(), "s" + syntheticSymbol);
    assert.equal(
      (await shortToken.methods.decimals().call()).toString(),
      (await collateralToken.methods.decimals().call()).toString()
    );
    assert.isTrue(await shortToken.methods.holdsRole("0", lspAddress).call());
    assert.isTrue(await shortToken.methods.holdsRole("1", lspAddress).call());
    assert.isTrue(await shortToken.methods.holdsRole("2", lspAddress).call());
  });
  it("Correctly respects non-18 decimal collateral currencies", async function () {
    const non18Collateral = await Token.new("USD Coin", "USDC", 6).send({ from: deployer });
    await collateralWhitelist.methods.addToWhitelist(non18Collateral.options.address).send({ from: accounts[0] });
    await longShortPairCreator.methods
      .createLongShortPair(
        ...Object.values({ ...constructorParams, collateralAddress: non18Collateral.options.address })
      )
      .send({ from: accounts[0] });

    const lspAddress = (await longShortPairCreator.getPastEvents("CreatedLongShortPair"))[0].returnValues.longShortPair;

    const lsp = await LongShortPair.at(lspAddress);

    assert.equal(await (await Token.at(await lsp.methods.longToken().call())).methods.decimals().call(), "6");
    assert.equal(await (await Token.at(await lsp.methods.shortToken().call())).methods.decimals().call(), "6");
  });

  it("Transfers prepaidProposerReward", async function () {
    const customPrepaidProposerReward = toWei("100");
    await collateralToken.methods.mint(deployer, customPrepaidProposerReward).send({ from: accounts[0] });
    await collateralToken.methods
      .approve(longShortPairCreator.options.address, customPrepaidProposerReward)
      .send({ from: accounts[0] });
    await longShortPairCreator.methods
      .createLongShortPair(
        ...Object.values({ ...constructorParams, prepaidProposerReward: customPrepaidProposerReward })
      )
      .send({ from: accounts[0] });

    const lspAddress = (await longShortPairCreator.getPastEvents("CreatedLongShortPair"))[0].returnValues.longShortPair;

    assert.equal((await collateralToken.methods.balanceOf(lspAddress).call()).toString(), customPrepaidProposerReward);
  });

  it("Rejects on past expirationTimestamp", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair(
            ...Object.values({
              ...constructorParams,
              expirationTimestamp: (await timer.methods.getCurrentTime().call()) - 100,
            })
          )
          .send({ from: accounts[0] })
      )
    );
  });
  it("Rejects on unregistered priceIdentifier", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair(
            ...Object.values({ ...constructorParams, priceFeedIdentifier: utf8ToHex("UNREGISTERED_IDENTIFIER") })
          )
          .send({ from: accounts[0] })
      )
    );
  });
  it("Rejects on unregistered collateralToken", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair(...Object.values({ ...constructorParams, collateralAddress: ZERO_ADDRESS }))
          .send({ from: accounts[0] })
      )
    );
  });
  it("Rejects on invalid financialProductLibrary", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair(...Object.values({ ...constructorParams, financialProductLibraryAddress: ZERO_ADDRESS }))
          .send({ from: accounts[0] })
      )
    );
  });
  it("Rejects on invalid synthetic token details", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair(...Object.values({ ...constructorParams, syntheticName: "" }))
          .send({ from: accounts[0] })
      )
    );
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair(...Object.values({ ...constructorParams, syntheticSymbol: "" }))
          .send({ from: accounts[0] })
      )
    );
  });
});
