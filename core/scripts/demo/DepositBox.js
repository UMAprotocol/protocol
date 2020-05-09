/**
 * @notice Deploys the a TOY financial contract, registers it with the DVM, and goes through a simple user flow.
 * @dev DepositBox is an example financial contract that integrates the DVM for on-chain price discovery.
 * It is intended for educational purposes and would not be very useful in practice. The purpose of the contract
 * is to hold custody of a user's ERC20 token balance. The user links the DepositBox with one of the price identifiers
 * enabled on the DVM. For example, the user might deposit ETH into the DepositBox and register it with the "ETH-USD"
 * price identifier. The user can now withdraw a "USD"-denominated amount of "ETH" from their DepositBox via
 * smart contract calls. The feature introduced by the DVM is on-chain pricing of the user's ERC20 balance. In this example,
 * the user would not have been able to transfer "USD"-denominated amounts of "ETH" without referencing an off-chain "ETH-USD"
 * price feed. The DVM therefore enables the user to "pull" a reference price.
 *
 * This script includes steps to deploy a "ETH-USD" DepositBox, register it with the DVM and the correct price identifier, and uses the DVM
 * to withdraw USD-denominated amounts of ETH
 *
 * How to run: `cd core && $(npm bin)/truffle exec ./scripts/demo/DepositBox.js --network test`
 * Assumptions:
 * - User is using a local blockchain (i.e. not Kovan/Ropsten/Rinkeby/Mainnet)
 * - User is running this script in the web3 environment injected by Truffle.
 * - User is sending transactions from accounts[0] of the injected web3.
 * - User is using wETH as the collateral ERC20.
 * - User is referencing the ETH-USD pricefeed identifier.
 * Prerequisites:
 * - Migrate the contracts via `$(npm bin)/truffle migrate --reset --network test`.
 */

// Helper modules
const { toWei, fromWei, utf8ToHex, hexToUtf8 } = web3.utils;
const { interfaceName } = require("../../utils/Constants");
const { RegistryRolesEnum } = require("../../../common/Enums");

const DepositBox = artifacts.require("DepositBox");
const WETH9 = artifacts.require("WETH9");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const Registry = artifacts.require("Registry");
const MockOracle = artifacts.require("MockOracle");

// Constants
const priceFeedIdentifier = utf8ToHex("ETH/USD");

// Deploy contract and return its address.
const deploy = async () => {
  console.group("1. Deploying new DepositBox");
  const collateral = await WETH9.deployed();
  console.log(`- Using WETH contract as collateral token @ ${collateral.address}`);

  // Pricefeed identifier must be whitelisted prior to DepositBox construction.
  const identifierWhitelist = await IdentifierWhitelist.deployed();
  await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier);
  console.log(`- Pricefeed identifier for ${hexToUtf8(priceFeedIdentifier)} is whitelisted`);

  // The following steps would differ if the user is on a testnet like Kovan in the following ways:
  // - The user would not need to deploy a "Mock Oracle" and register it with the Finder,
  // but using the mock oracle is convenient for testing by allowing the user to manually resolves prices.
  // - The user should pass in the zero address (i.e. 0x0) for the Timer, but using the deployed Timer
  // for testing purposes is convenient because they can advance time as needed.
  const finder = await Finder.deployed();
  console.log(`- Using Finder @ ${finder.address}`);
  const mockOracle = await MockOracle.new(finder.address, Timer.address);
  console.log(`- Deployed MockOracle @ ${mockOracle.address}`);
  const mockOracleInterfaceName = utf8ToHex(interfaceName.Oracle);
  await finder.changeImplementationAddress(mockOracleInterfaceName, mockOracle.address);
  console.log("- Set Finder.Oracle to MockOracle");

  // Deploy a new DepositBox contract. The DVM or "oracle" that the DepositBox will use
  // will be the one that is registered with the Finder. The above steps ensure that the "MockOracle"
  // is used on local blockchains. Again, if not on a local blockchain, use the zero address for the Timer address.
  const depositBox = await DepositBox.new(collateral.address, finder.address, priceFeedIdentifier, Timer.address);
  console.log(`- Deployed @ ${depositBox.address}`);
  console.groupEnd();
  return depositBox.address;
};

// Register contract with DVM.
const register = async depositBoxAddress => {
  console.group("2. Registering DepositBox with DVM");

  // To use the DVM, every financial contract needs to be registered. Since the DepositBox
  // is intended to be used on local blockchains for educational purposes, it has an
  // `initialize()` public method that will register itself with the DVM.  Therefore
  // we need to grant the DepositBox the power to register contracts with the DVM.
  // In production environments, the Governor contract owns this privilege to register contracts
  // with the DVM. Therefore, the `initialize()` method would fail in production environments.
  const depositBox = await DepositBox.at(depositBoxAddress);

  // The `CONTRACT_CREATOR` role grants the DepositBox the power to register itself with the DVM.
  // This step assumes that the user has the ability to assign Registry roles, which is a role
  // held by the deployer of the Registry.
  const registry = await Registry.deployed();
  console.log(`- Using Registry @ ${registry.address}`);
  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, depositBox.address);
  console.log("- Granted CONTRACT_CREATOR role to DepositBox");
  await depositBox.initialize();
  console.log("- DepositBox registered itself with DVM");
  console.groupEnd();
  return;
};

// Set up allowances and mint collateral tokens.
const setupWallets = async (depositBoxAddress, amountOfWethToMint) => {
  const accounts = await web3.eth.getAccounts();

  console.group("3. Minting ERC20 to user and giving DepositBox allowance to transfer collateral");
  const collateral = await WETH9.deployed();
  console.log(`- Using WETH contract @ ${collateral.address}`);

  // WETH must be converted from ETH via `deposit()`.
  await collateral.deposit({ value: amountOfWethToMint });
  console.log(`- Converted ${fromWei(amountOfWethToMint)} ETH into WETH`);
  const postBalance = await collateral.balanceOf(accounts[0]);
  console.log(`- User's WETH balance: ${fromWei(postBalance.toString())}`);

  // DepositBox needs to be able to transfer collateral on behalf of user.
  await collateral.approve(depositBoxAddress, amountOfWethToMint);
  console.log("- Increased DepositBox allowance to spend WETH");
  const postAllowance = await collateral.allowance(accounts[0], depositBoxAddress);
  console.log(`- Contract's WETH allowance: ${fromWei(postAllowance.toString())}`);
  return;
};

// Main script.
const main = async callback => {
  try {
    // Deploy
    const deployedContract = await deploy();
    console.log("\n");

    // Register
    await register(deployedContract);
    console.log("\n");

    // Mint collateral
    const amountOfWethToMint = toWei("1000");
    await setupWallets(deployedContract, amountOfWethToMint);
    console.log("\n");

    // Deposit collateral
    // TODO

    // Withdraw USD denominated collateteral
    // TODO
  } catch (err) {
    throw err;
  }
  callback();
};

module.exports = main;
