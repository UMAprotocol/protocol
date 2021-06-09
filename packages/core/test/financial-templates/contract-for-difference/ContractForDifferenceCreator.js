const { toWei, utf8ToHex, hexToUtf8 } = web3.utils;
const truffleAssert = require("truffle-assertions");
const { assert } = require("chai");

// Libraries and helpers
const { interfaceName, didContractThrow, ZERO_ADDRESS } = require("@uma/common");

// Tested Contract
const ContractForDifference = artifacts.require("ContractForDifference");
const ContractForDifferenceCreator = artifacts.require("ContractForDifferenceCreator");
const ContractForDifferenceFinancialProjectLibraryTest = artifacts.require(
  "ContractForDifferenceFinancialProjectLibraryTest"
);

// Helper contracts
const AddressWhitelist = artifacts.require("AddressWhitelist");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const OptimisticOracle = artifacts.require("OptimisticOracle");
const Token = artifacts.require("ExpandedERC20");
const TokenFactory = artifacts.require("TokenFactory");

let collateralToken;
let contractForDifferenceLibrary;
let contractForDifferenceCreator;
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
const syntheticName = "Test CFD";
const syntheticSymbol = "tCFD";

contract("ContractForDifferenceCreator", function (accounts) {
  const deployer = accounts[0];
  const sponsor = accounts[1];

  before(async () => {
    finder = await Finder.deployed();
    timer = await Timer.deployed();
    collateralWhitelist = await AddressWhitelist.deployed();

    identifierWhitelist = await IdentifierWhitelist.deployed();
    await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier, { from: deployer });
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

    contractForDifferenceCreator = await ContractForDifferenceCreator.new(
      finder.address,
      (await TokenFactory.deployed()).address,
      timer.address
    );

    contractForDifferenceLibrary = await ContractForDifferenceFinancialProjectLibraryTest.new();

    // Define an object to easily re-use constructor params
    constructorParams = {
      expirationTimestamp,
      collateralPerPair,
      priceFeedIdentifier,
      syntheticName,
      syntheticSymbol,
      collateralAddress: collateralToken.address,
      financialProductLibraryAddress: contractForDifferenceLibrary.address,
    };
  });

  it("Can correctly create a CFD with valid params", async function () {
    // Can create a new CFD with the creator.
    const cfdAddress = await contractForDifferenceCreator.createContractForDifference.call(
      ...Object.values(constructorParams)
    );

    const cfdCreateTx = await contractForDifferenceCreator.createContractForDifference(
      ...Object.values(constructorParams)
    );

    // Event should be emitted correctly.
    truffleAssert.eventEmitted(cfdCreateTx, "CreatedContractForDifference", (ev) => {
      return ev.contractForDifference == cfdAddress && ev.deployerAddress == deployer;
    });

    // Validate CFD parameters are set correctly.
    const cfd = await ContractForDifference.at(cfdAddress);
    assert.equal(await cfd.expirationTimestamp(), expirationTimestamp);
    assert.equal((await cfd.collateralPerPair()).toString(), collateralPerPair.toString());
    assert.equal(hexToUtf8(await cfd.priceIdentifier()), hexToUtf8(priceFeedIdentifier));
    assert.equal(await cfd.collateralToken(), collateralToken.address);

    // Validate token information and permissions are set correctly.
    const longToken = await Token.at(await cfd.longToken());
    assert.equal(await longToken.name(), syntheticName + " Long Token");
    assert.equal(await longToken.symbol(), "l" + syntheticSymbol);
    assert.equal((await longToken.decimals()).toString(), (await collateralToken.decimals()).toString());
    assert.isTrue(await longToken.holdsRole("0", cfdAddress));
    assert.isTrue(await longToken.holdsRole("1", cfdAddress));
    assert.isTrue(await longToken.holdsRole("2", cfdAddress));

    const shortToken = await Token.at(await cfd.shortToken());
    assert.equal(await shortToken.name(), syntheticName + " Short Token");
    assert.equal(await shortToken.symbol(), "s" + syntheticSymbol);
    assert.equal((await shortToken.decimals()).toString(), (await collateralToken.decimals()).toString());
    assert.isTrue(await shortToken.holdsRole("0", cfdAddress));
    assert.isTrue(await shortToken.holdsRole("1", cfdAddress));
    assert.isTrue(await shortToken.holdsRole("2", cfdAddress));
  });
  it("Correctly respects non-18 decimal collateral currencies", async function () {
    const non18Collateral = await Token.new("USD Coin", "USDC", 6, { from: deployer });
    await collateralWhitelist.addToWhitelist(non18Collateral.address);
    await contractForDifferenceCreator.createContractForDifference(
      ...Object.values({ ...constructorParams, collateralAddress: non18Collateral.address })
    );

    const cfdAddress = (await contractForDifferenceCreator.getPastEvents("CreatedContractForDifference"))[0]
      .returnValues.contractForDifference;

    const cfd = await ContractForDifference.at(cfdAddress);

    assert.equal(await (await Token.at(await cfd.longToken())).decimals(), "6");
    assert.equal(await (await Token.at(await cfd.shortToken())).decimals(), "6");
  });

  it("Rejects on past expirationTimestamp", async function () {
    assert(
      await didContractThrow(
        contractForDifferenceCreator.createContractForDifference(
          ...Object.values({ ...constructorParams, expirationTimestamp: (await timer.getCurrentTime()) - 100 })
        )
      )
    );
  });
  it("Rejects on unregistered priceIdentifier", async function () {
    assert(
      await didContractThrow(
        contractForDifferenceCreator.createContractForDifference(
          ...Object.values({ ...constructorParams, priceFeedIdentifier: utf8ToHex("UNREGISTERED_IDENTIFIER") })
        )
      )
    );
  });
  it("Rejects on unregistered collateralToken", async function () {
    assert(
      await didContractThrow(
        contractForDifferenceCreator.createContractForDifference(
          ...Object.values({ ...constructorParams, collateralAddress: ZERO_ADDRESS })
        )
      )
    );
  });
  it("Rejects on invalid financialProductLibrary", async function () {
    assert(
      await didContractThrow(
        contractForDifferenceCreator.createContractForDifference(
          ...Object.values({ ...constructorParams, financialProductLibraryAddress: ZERO_ADDRESS })
        )
      )
    );
  });
  it("Rejects on invalid synthetic token details", async function () {
    assert(
      await didContractThrow(
        contractForDifferenceCreator.createContractForDifference(
          ...Object.values({ ...constructorParams, syntheticName: "" })
        )
      )
    );
    assert(
      await didContractThrow(
        contractForDifferenceCreator.createContractForDifference(
          ...Object.values({ ...constructorParams, syntheticSymbol: "" })
        )
      )
    );
  });
});
