const hre = require("hardhat");
const { getContract } = hre;

const { assert } = require("chai");

const { getProviders, deployContractOnProvider, deployContractUsingEthers } = require("./helpers/MultiProviderHelper");

const { l1Web3, l2Web3 } = getProviders();

// Tested contract
const BridgeDepositBox = getContract("BridgeDepositBox");

// Helper contracts
// const Token = getContract("ExpandedERC20");

// Contract objects
let depositBox;
let BridgeRouter;
let l1Token;
let l2Token;

describe("End To End tests", () => {
  let l1Accounts, l2Accounts;

  beforeEach(async function () {
    l1Accounts = await l1Web3.eth.getAccounts();
    console.log("l1Accounts", l1Accounts);
    l2Accounts = await l2Web3.eth.getAccounts();
    console.log("l2Accounts", l2Accounts);

    // l1Token = await deployContractOnProvider(Token, l1Web3, ["Wrapped Ether", "WETH", 18], l1Accounts[0]);
    // console.log("l1 address", l1Token.options.address);
    // l2Token = await deployContractOnProvider(Token, l2Web3, ["Wrapped Ether", "WETH", 18], l2Accounts[0]);
    // console.log("l2 address", l2Token.options.address);

    l1Token = await deployContractOnProvider(BridgeDepositBox, l1Web3, [l1Accounts[0], l1Accounts[0]], l1Accounts[0]);
    console.log("l1 address", l1Token.options.address);
    l2Token = await deployContractOnProvider(BridgeDepositBox, web3, [l1Accounts[0], l1Accounts[0]], l2Accounts[0]);
    console.log("l2 address", l2Token.options.address);

    // l2Token = await deployContractUsingEthers(
    //   "BridgeDepositBox",
    //   l2Web3,
    //   [l1Accounts[0], l1Accounts[0], { gasLimit: 5000000, gasPrice: 0 }],
    //   l2Accounts[0]
    // );
    // console.log("l2 address", l2Token);
  });
  describe("Cross domain messaging", () => {
    it("Transfer ownership", async () => {
      assert.isTrue(true);
    });
  });
});
