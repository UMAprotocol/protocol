const { toWei, utf8ToHex, hexToUtf8, padRight } = web3.utils;
const truffleAssert = require("truffle-assertions");
const { assert } = require("chai");

// Libraries and helpers
const { interfaceName, didContractThrow, ZERO_ADDRESS } = require("@uma/common");

// Tested Contract
const LongShortPair = artifacts.require("LongShortPair");
const LongShortPairCreator = artifacts.require("LongShortPairCreator");
const LongShortPairFinancialProjectLibraryTest = artifacts.require("LongShortPairFinancialProjectLibraryTest");

// Helper contracts
const AddressWhitelist = artifacts.require("AddressWhitelist");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const OptimisticOracle = artifacts.require("OptimisticOracle");
const Token = artifacts.require("ExpandedERC20");
const TokenFactory = artifacts.require("TokenFactory");

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
const priceIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const collateralPerPair = toWei("1"); // each pair of long and short tokens need 1 unit of collateral to mint.
const longSynthName = "Long Test LSP";
const longSynthSymbol = "LtCFD";
const shortSynthName = "Short Test LSP";
const shortSynthSymbol = "StCFD";
const customAncillaryData = web3.utils.utf8ToHex("some-address-field:0x1234");
const prepaidProposerReward = "0";
const pairName = "Long Short Pair Test";
const optimisticOracleLivenessTime = 7200;
const optimisticOracleProposerBond = "0";

contract("LongShortPairCreator", function (accounts) {
  const deployer = accounts[0];
  const sponsor = accounts[1];

  before(async () => {
    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceIdentifier, { from: deployer });
  });

  beforeEach(async function () {
    // Force each test to start with a simulated time that's synced to the startTimestamp.
    await timer.setCurrentTime(startTimestamp);

    collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: deployer });
    await collateralToken.addMember(1, deployer, { from: deployer });
    await collateralToken.mint(sponsor, toWei("1000"), { from: deployer });

    await collateralWhitelist.addToWhitelist(collateralToken.address);

    optimisticOracle = await OptimisticOracle.new(optimisticOracleLiveness, finder.address, timer.address);
    await finder.changeImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle), optimisticOracle.address, {
      from: deployer,
    });

    longShortPairCreator = await LongShortPairCreator.new(
      finder.address,
      (await TokenFactory.deployed()).address,
      timer.address
    );

    longShortPairLibrary = await LongShortPairFinancialProjectLibraryTest.new();

    // Define an object to easily re-use constructor params
    constructorParams = {
      pairName,
      expirationTimestamp,
      collateralPerPair,
      priceIdentifier,
      longSynthName,
      longSynthSymbol,
      shortSynthName,
      shortSynthSymbol,
      collateralToken: collateralToken.address,
      financialProductLibrary: longShortPairLibrary.address,
      customAncillaryData,
      prepaidProposerReward,
      optimisticOracleLivenessTime,
      optimisticOracleProposerBond,
    };
  });

  it("Can correctly create a LSP with valid params", async function () {
    // Can create a new LSP with the creator.
    const lspAddress = await longShortPairCreator.createLongShortPair.call(constructorParams);

    const lspCreateTx = await longShortPairCreator.createLongShortPair(constructorParams);

    // Event should be emitted correctly.
    truffleAssert.eventEmitted(lspCreateTx, "CreatedLongShortPair", (ev) => {
      return ev.longShortPair == lspAddress && ev.deployerAddress == deployer;
    });

    // Validate LSP parameters are set correctly.
    const lsp = await LongShortPair.at(lspAddress);
    assert.equal(await lsp.pairName(), pairName);
    assert.equal(await lsp.expirationTimestamp(), expirationTimestamp);
    assert.equal((await lsp.collateralPerPair()).toString(), collateralPerPair.toString());
    assert.equal(hexToUtf8(await lsp.priceIdentifier()), hexToUtf8(priceIdentifier));
    assert.equal(await lsp.collateralToken(), collateralToken.address);
    assert.equal(await lsp.customAncillaryData(), customAncillaryData);
    assert.equal(await lsp.optimisticOracleLivenessTime(), optimisticOracleLivenessTime);
    assert.equal(await lsp.optimisticOracleProposerBond(), optimisticOracleProposerBond);

    // Validate token information and permissions are set correctly.
    const longToken = await Token.at(await lsp.longToken());
    assert.equal(await longToken.name(), longSynthName);
    assert.equal(await longToken.symbol(), longSynthSymbol);
    assert.equal((await longToken.decimals()).toString(), (await collateralToken.decimals()).toString());
    assert.isTrue(await longToken.holdsRole("0", lspAddress)); // owner
    assert.isTrue(await longToken.holdsRole("1", lspAddress)); // minter
    assert.isTrue(await longToken.holdsRole("2", lspAddress)); // burner

    const shortToken = await Token.at(await lsp.shortToken());
    assert.equal(await shortToken.name(), shortSynthName);
    assert.equal(await shortToken.symbol(), shortSynthSymbol);
    assert.equal((await shortToken.decimals()).toString(), (await collateralToken.decimals()).toString());
    assert.isTrue(await shortToken.holdsRole("0", lspAddress)); // owner
    assert.isTrue(await shortToken.holdsRole("1", lspAddress)); // minter
    assert.isTrue(await shortToken.holdsRole("2", lspAddress)); // burner

    // The creator should not hold any roles on the LSP contract.
    assert.isFalse(await longToken.holdsRole("0", longShortPairCreator.address)); // owner
    assert.isFalse(await longToken.holdsRole("1", longShortPairCreator.address)); // minter
    assert.isFalse(await longToken.holdsRole("2", longShortPairCreator.address)); // burner
    assert.isFalse(await shortToken.holdsRole("0", longShortPairCreator.address)); // owner
    assert.isFalse(await shortToken.holdsRole("1", longShortPairCreator.address)); // minter
    assert.isFalse(await shortToken.holdsRole("2", longShortPairCreator.address)); // burner
  });
  it("Correctly respects non-18 decimal collateral currencies", async function () {
    const non18Collateral = await Token.new("USD Coin", "USDC", 6, { from: deployer });
    await collateralWhitelist.addToWhitelist(non18Collateral.address);
    await longShortPairCreator.createLongShortPair({ ...constructorParams, collateralToken: non18Collateral.address });

    const lspAddress = (await longShortPairCreator.getPastEvents("CreatedLongShortPair"))[0].returnValues.longShortPair;

    const lsp = await LongShortPair.at(lspAddress);

    assert.equal((await (await Token.at(await lsp.longToken())).decimals()).toString(), "6");
    assert.equal((await (await Token.at(await lsp.shortToken())).decimals()).toString(), "6");
  });

  it("Transfers prepaidProposerReward", async function () {
    const customPrepaidProposerReward = toWei("100");
    await collateralToken.mint(deployer, customPrepaidProposerReward);
    await collateralToken.approve(longShortPairCreator.address, customPrepaidProposerReward);
    await longShortPairCreator.createLongShortPair({
      ...constructorParams,
      prepaidProposerReward: customPrepaidProposerReward,
    });

    const lspAddress = (await longShortPairCreator.getPastEvents("CreatedLongShortPair"))[0].returnValues.longShortPair;

    assert.equal((await collateralToken.balanceOf(lspAddress)).toString(), customPrepaidProposerReward);
  });

  it("Rejects on past expirationTimestamp", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.createLongShortPair({
          ...constructorParams,
          expirationTimestamp: (await timer.getCurrentTime()) - 100,
        })
      )
    );
  });
  it("Rejects on unregistered priceIdentifier", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.createLongShortPair({
          ...constructorParams,
          priceIdentifier: utf8ToHex("UNREGISTERED_IDENTIFIER"),
        })
      )
    );
  });
  it("Rejects on unregistered collateralToken", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.createLongShortPair({ ...constructorParams, collateralToken: ZERO_ADDRESS })
      )
    );
  });
  it("Rejects on invalid financialProductLibrary", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.createLongShortPair({ ...constructorParams, financialProductLibrary: ZERO_ADDRESS })
      )
    );
  });
  it("Rejects on invalid synthetic token details", async function () {
    assert(
      await didContractThrow(longShortPairCreator.createLongShortPair({ ...constructorParams, longSynthName: "" }))
    );
    assert(
      await didContractThrow(longShortPairCreator.createLongShortPair({ ...constructorParams, longSynthSymbol: "" }))
    );
    assert(
      await didContractThrow(longShortPairCreator.createLongShortPair({ ...constructorParams, shortSynthName: "" }))
    );
    assert(
      await didContractThrow(longShortPairCreator.createLongShortPair({ ...constructorParams, shortSynthSymbol: "" }))
    );
  });
});
