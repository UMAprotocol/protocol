const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract, assertEventEmitted } = hre;
const { toWei, utf8ToHex, hexToUtf8, padRight } = web3.utils;
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
const priceIdentifier = padRight(utf8ToHex("TEST_IDENTIFIER"), 64);
const enableEarlyExpiration = true;
const collateralPerPair = toWei("1"); // each pair of long and short tokens need 1 unit of collateral to mint.
const longSynthName = "Long Test LSP";
const longSynthSymbol = "LtCFD";
const shortSynthName = "Short Test LSP";
const shortSynthSymbol = "StCFD";
const customAncillaryData = web3.utils.utf8ToHex("some-address-field:0x1234");
const proposerReward = "0";
const pairName = "Long Short Pair Test";
const optimisticOracleLivenessTime = 7200;
const optimisticOracleProposerBond = "0";

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
    await identifierWhitelist.methods.addSupportedIdentifier(priceIdentifier).send({ from: deployer });
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
      pairName,
      expirationTimestamp,
      collateralPerPair,
      priceIdentifier,
      enableEarlyExpiration,
      longSynthName,
      longSynthSymbol,
      shortSynthName,
      shortSynthSymbol,
      collateralToken: collateralToken.options.address,
      financialProductLibrary: longShortPairLibrary.options.address,
      customAncillaryData,
      proposerReward,
      optimisticOracleLivenessTime,
      optimisticOracleProposerBond,
    };
  });

  it("Can correctly create a LSP with valid params", async function () {
    // Can create a new LSP with the creator.
    const lspAddress = await longShortPairCreator.methods.createLongShortPair(constructorParams).call();

    const lspCreateTx = await longShortPairCreator.methods
      .createLongShortPair(constructorParams)
      .send({ from: accounts[0] });

    // Event should be emitted correctly.
    await assertEventEmitted(lspCreateTx, longShortPairCreator, "CreatedLongShortPair", (ev) => {
      return ev.longShortPair == lspAddress && ev.deployerAddress == deployer;
    });

    // Validate LSP parameters are set correctly.
    const lsp = await LongShortPair.at(lspAddress);
    assert.equal(await lsp.methods.pairName().call(), pairName);
    assert.equal(await lsp.methods.expirationTimestamp().call(), expirationTimestamp);
    assert.equal((await lsp.methods.collateralPerPair().call()).toString(), collateralPerPair.toString());
    assert.equal(hexToUtf8(await lsp.methods.priceIdentifier().call()), hexToUtf8(priceIdentifier));
    assert.equal(await lsp.methods.enableEarlyExpiration().call(), enableEarlyExpiration);
    assert.equal(await lsp.methods.collateralToken().call(), collateralToken.options.address);
    assert.equal(await lsp.methods.customAncillaryData().call(), customAncillaryData);
    assert.equal(await lsp.methods.optimisticOracleLivenessTime().call(), optimisticOracleLivenessTime);
    assert.equal(await lsp.methods.optimisticOracleProposerBond().call(), optimisticOracleProposerBond);

    // Validate token information and permissions are set correctly.
    const longToken = await Token.at(await lsp.methods.longToken().call());
    assert.equal(await longToken.methods.name().call(), longSynthName);
    assert.equal(await longToken.methods.symbol().call(), longSynthSymbol);
    assert.equal(
      (await longToken.methods.decimals().call()).toString(),
      (await collateralToken.methods.decimals().call()).toString()
    );
    assert.isTrue(await longToken.methods.holdsRole("0", lspAddress).call()); // owner
    assert.isTrue(await longToken.methods.holdsRole("1", lspAddress).call()); // minter
    assert.isTrue(await longToken.methods.holdsRole("2", lspAddress).call()); // burner

    const shortToken = await Token.at(await lsp.methods.shortToken().call());
    assert.equal(await shortToken.methods.name().call(), shortSynthName);
    assert.equal(await shortToken.methods.symbol().call(), shortSynthSymbol);
    assert.equal(
      (await shortToken.methods.decimals().call()).toString(),
      (await collateralToken.methods.decimals().call()).toString()
    );
    assert.isTrue(await shortToken.methods.holdsRole("0", lspAddress).call()); // owner
    assert.isTrue(await shortToken.methods.holdsRole("1", lspAddress).call()); // minter
    assert.isTrue(await shortToken.methods.holdsRole("2", lspAddress).call()); // burner

    // The creator should not hold any roles on the LSP contract.
    assert.isFalse(await longToken.methods.holdsRole("0", longShortPairCreator.options.address).call()); // owner
    assert.isFalse(await longToken.methods.holdsRole("1", longShortPairCreator.options.address).call()); // minter
    assert.isFalse(await longToken.methods.holdsRole("2", longShortPairCreator.options.address).call()); // burner
    assert.isFalse(await shortToken.methods.holdsRole("0", longShortPairCreator.options.address).call()); // owner
    assert.isFalse(await shortToken.methods.holdsRole("1", longShortPairCreator.options.address).call()); // minter
    assert.isFalse(await shortToken.methods.holdsRole("2", longShortPairCreator.options.address).call()); // burner
  });
  it("Correctly respects non-18 decimal collateral currencies", async function () {
    const non18Collateral = await Token.new("USD Coin", "USDC", 6).send({ from: deployer });
    await collateralWhitelist.methods.addToWhitelist(non18Collateral.options.address).send({ from: accounts[0] });
    await longShortPairCreator.methods
      .createLongShortPair({ ...constructorParams, collateralToken: non18Collateral.options.address })
      .send({ from: accounts[0] });

    const lspAddress = (await longShortPairCreator.getPastEvents("CreatedLongShortPair"))[0].returnValues.longShortPair;

    const lsp = await LongShortPair.at(lspAddress);

    assert.equal(await (await Token.at(await lsp.methods.longToken().call())).methods.decimals().call(), "6");
    assert.equal(await (await Token.at(await lsp.methods.shortToken().call())).methods.decimals().call(), "6");
  });

  it("Rejects on past expirationTimestamp", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair({
            ...constructorParams,
            expirationTimestamp: (await timer.methods.getCurrentTime().call()) - 100,
          })
          .send({ from: accounts[0] })
      )
    );
  });
  it("Rejects on unregistered priceIdentifier", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair({
            ...constructorParams,
            priceIdentifier: padRight(utf8ToHex("UNREGISTERED_IDENTIFIER"), 64),
          })
          .send({ from: accounts[0] })
      )
    );
  });
  it("Rejects on unregistered collateralToken", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair({ ...constructorParams, collateralToken: ZERO_ADDRESS })
          .send({ from: accounts[0] })
      )
    );
  });
  it("Rejects on invalid financialProductLibrary", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair({ ...constructorParams, financialProductLibrary: ZERO_ADDRESS })
          .send({ from: accounts[0] })
      )
    );
  });
  it("Rejects on invalid synthetic token details", async function () {
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair({ ...constructorParams, longSynthName: "" })
          .send({ from: accounts[0] })
      )
    );
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair({ ...constructorParams, longSynthSymbol: "" })
          .send({ from: accounts[0] })
      )
    );
    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair({ ...constructorParams, shortSynthName: "" })
          .send({ from: accounts[0] })
      )
    );

    assert(
      await didContractThrow(
        longShortPairCreator.methods
          .createLongShortPair({ ...constructorParams, shortSynthSymbol: "" })
          .send({ from: accounts[0] })
      )
    );
  });
});
