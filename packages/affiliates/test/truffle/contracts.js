const { getWeb3, interfaceName, ZERO_ADDRESS } = require("@uma/common");
const { Emp, Erc20 } = require("../../libs/contracts");

// Contracts and helpers
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const Finder = artifacts.require("Finder");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const MockOracle = artifacts.require("MockOracle");
const Token = artifacts.require("ExpandedERC20");
const SyntheticToken = artifacts.require("SyntheticToken");
const Timer = artifacts.require("Timer");
const Store = artifacts.require("Store");

const { toWei, utf8ToHex, padRight } = web3.utils;

contract("contracts", function(accounts) {
  describe("emp contract", function() {
    let emp, empContract, web3, collateralToken, token, timer, collateral;
    const contractCreator = accounts[4];
    before(async function() {
      const identifier = "TEST_IDENTIFIER";
      const identifierWhitelist = await IdentifierWhitelist.deployed();
      await identifierWhitelist.addSupportedIdentifier(utf8ToHex(identifier));
      collateralToken = await Token.new("Wrapped Ether", "WETH", 18, { from: contractCreator });
      token = await SyntheticToken.new("Test Synthetic Token", "SYNTH", 18);
      const finder = await Finder.deployed();
      const mockOracle = await MockOracle.new(finder.address, Timer.address, {
        from: contractCreator
      });
      const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
      await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);
      const store = await Store.deployed();
      timer = await Timer.deployed();
      const empConfig = {
        expirationTimestamp: Date.now() + 1000 * 60 * 60 * 24 * 1000,
        withdrawalLiveness: "1000",
        collateralAddress: collateralToken.address,
        tokenAddress: token.address,
        finderAddress: finder.address,
        priceFeedIdentifier: padRight(utf8ToHex(identifier), 64),
        liquidationLiveness: "1000",
        collateralRequirement: { rawValue: toWei("1.2") },
        disputeBondPercentage: { rawValue: toWei("0.1") },
        sponsorDisputeRewardPercentage: { rawValue: toWei("0.1") },
        disputerDisputeRewardPercentage: { rawValue: toWei("0.1") },
        minSponsorTokens: { rawValue: toWei("5") },
        timerAddress: timer.address,
        excessTokenBeneficiary: store.address,
        financialProductLibraryAddress: ZERO_ADDRESS
      };

      web3 = getWeb3();
      // Deploy a new expiring multi party
      empContract = await ExpiringMultiParty.new(empConfig);
      await token.addMinter(empContract.address);
      await token.addBurner(empContract.address);
      emp = Emp({ web3 });
      collateral = Erc20({ web3 });
      token = Erc20({ web3 });
    });
    it("gets collateral address", async function() {
      const result = await emp.collateralCurrency(empContract.address);
      assert.equal(result, collateralToken.address);
    });
    it("gets token address", async function() {
      const result = await emp.tokenCurrency(empContract.address);
      assert.equal(result, await empContract.tokenCurrency());
    });
    it("check token decimals", async function() {
      const result = await token.decimals(await empContract.tokenCurrency());
      assert.equal(result, 18);
    });
    it("check collateral decimals", async function() {
      const result = await collateral.decimals(collateralToken.address);
      assert.equal(result, 18);
    });
    it("gets collateral info", async function() {
      const result = await emp.collateralInfo(empContract.address);
      assert.equal(result.address, collateralToken.address);
      assert.equal(result.decimals, 18);
    });
    it("gets token info", async function() {
      const result = await emp.tokenInfo(empContract.address);
      assert.equal(result.address, await empContract.tokenCurrency());
      assert.equal(result.decimals, 18);
    });
    it("gets emp info", async function() {
      const result = await emp.info(empContract.address);
      assert.equal(result.address, empContract.address);
      assert.equal(result.token.address, await empContract.tokenCurrency());
      assert.equal(result.token.decimals, 18);
      assert.equal(result.collateral.address, collateralToken.address);
      assert.equal(result.collateral.decimals, 18);
    });
  });
});
