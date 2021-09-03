const hre = require("hardhat");
const { assert } = require("chai");
const { web3, getContract } = hre;
global.hre = hre;
global.web3 = web3;

const { getWeb3, interfaceName, ZERO_ADDRESS, runDefaultFixture } = require("@uma/common");
const { Emp, Erc20 } = require("../../libs/contracts");

// Contracts and helpers
const ExpiringMultiParty = getContract("ExpiringMultiParty");
const Finder = getContract("Finder");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const MockOracle = getContract("MockOracle");
const Token = getContract("ExpandedERC20");
const SyntheticToken = getContract("SyntheticToken");
const Timer = getContract("Timer");
const Store = getContract("Store");

const { toWei, utf8ToHex, padRight } = web3.utils;

describe("contracts", function () {
  let contractCreator, accounts;
  before(async function () {
    accounts = await web3.eth.getAccounts();
    contractCreator = accounts[4];
    await runDefaultFixture(hre);
  });
  describe("emp contract", function () {
    let emp, empContract, web3, collateralToken, token, timer, collateral;
    before(async function () {
      const identifier = "TEST_IDENTIFIER";
      const identifierWhitelist = await IdentifierWhitelist.deployed();
      await identifierWhitelist.methods.addSupportedIdentifier(utf8ToHex(identifier)).send({ from: accounts[0] });
      collateralToken = await Token.new("Wrapped Ether", "WETH", 18).send({ from: contractCreator });
      token = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18).send({ from: accounts[0] });
      const finder = await Finder.deployed();
      timer = await Timer.deployed();
      const mockOracle = await MockOracle.new(finder.options.address, timer.options.address).send({
        from: contractCreator,
      });
      const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
      await finder.methods
        .changeImplementationAddress(mockOracleInterfaceName, mockOracle.options.address)
        .send({ from: accounts[0] });
      const store = await Store.deployed();
      const empConfig = {
        expirationTimestamp: Date.now() + 1000 * 60 * 60 * 24 * 1000,
        withdrawalLiveness: "1000",
        collateralAddress: collateralToken.options.address,
        tokenAddress: token.options.address,
        finderAddress: finder.options.address,
        priceFeedIdentifier: padRight(utf8ToHex(identifier), 64),
        liquidationLiveness: "1000",
        collateralRequirement: { rawValue: toWei("1.2") },
        disputeBondPercentage: { rawValue: toWei("0.1") },
        sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
        disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
        minSponsorTokens: { rawValue: toWei("5") },
        timerAddress: timer.options.address,
        excessTokenBeneficiary: store.options.address,
        financialProductLibraryAddress: ZERO_ADDRESS,
      };

      web3 = getWeb3();
      // Deploy a new expiring multi party
      empContract = await ExpiringMultiParty.new(empConfig).send({ from: accounts[0] });
      await token.methods.addMinter(empContract.options.address).send({ from: accounts[0] });
      await token.methods.addBurner(empContract.options.address).send({ from: accounts[0] });
      emp = Emp({ web3 });
      collateral = Erc20({ web3 });
      token = Erc20({ web3 });
    });
    it("gets collateral address", async function () {
      const result = await emp.collateralCurrency(empContract.options.address);
      assert.equal(result, collateralToken.options.address);
    });
    it("gets token address", async function () {
      const result = await emp.tokenCurrency(empContract.options.address);
      assert.equal(result, await empContract.methods.tokenCurrency().call());
    });
    it("check token decimals", async function () {
      const result = await token.decimals(await empContract.methods.tokenCurrency().call());
      assert.equal(result, 18);
    });
    it("check collateral decimals", async function () {
      const result = await collateral.decimals(collateralToken.options.address);
      assert.equal(result, 18);
    });
    it("gets collateral info", async function () {
      const result = await emp.collateralInfo(empContract.options.address);
      assert.equal(result.address, collateralToken.options.address);
      assert.equal(result.decimals, 18);
    });
    it("gets token info", async function () {
      const result = await emp.tokenInfo(empContract.options.address);
      assert.equal(result.address, await empContract.methods.tokenCurrency().call());
      assert.equal(result.decimals, 18);
    });
    it("gets emp info", async function () {
      const result = await emp.info(empContract.options.address);
      assert.equal(result.address, empContract.options.address);
      assert.equal(result.token.address, await empContract.methods.tokenCurrency().call());
      assert.equal(result.token.decimals, 18);
      assert.equal(result.collateral.address, collateralToken.options.address);
      assert.equal(result.collateral.decimals, 18);
    });
  });
});
