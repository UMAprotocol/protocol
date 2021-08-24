/**
 * @notice Deploys a toy financial contract and goes through a simple user flow.
 * @dev OptimisticDepositBox is an example financial contract that integrates the Optimistic Oracle for on-chain price discovery.
 * It is intended for educational purposes and would not be very useful in practice. The purpose of the contract
 * is to custody a user's ERC20 token balance. The user links the OptimisticDepositBox with one of the price identifiers
 * enabled on UMA. For example, the user might deposit ETH into the OptimisticDepositBox and register it with the "ETH/USD"
 * price identifier. The user can now withdraw a "USD"-denominated amount of "ETH" from their OptimisticDepositBox via
 * smart contract calls. The feature introduced by Optimistic Oracle is optimistic on-chain pricing of the user's ERC20 balance.
 *
 * In this example, the user would not have been able to transfer "USD"-denominated amounts of "ETH" without referencing an
 * off-chain "ETH/USD" price feed. The Optimistic Oracle therefore enables the user to "pull" a reference price, without
 * going to the DVM unless there is a dispute.
 *
 * This script includes steps to deploy an "ETH/USD" OptimisticDepositBox and use the Optimistic Oracle
 * to withdraw USD-denominated amounts of ETH.
 *
 * How to run:
 * - Run a local Ganache instance (i.e. not Kovan/Ropsten/Rinkeby/Mainnet) with `ganache-cli --port 9545`.
 * - In a separate terminal window, compile the contracts via `yarn truffle compile`.
 * - Migrate the contracts via `yarn truffle migrate --reset --network test`.
 * - The migration step ensures that the user is the owner of the Finder, IdentifierWhitelist,
 *   Registry, and other important system contracts and can therefore modify their configurations.
 * - Run `yarn truffle exec ./scripts/demo/OptimisticDepositBox.js --network test`.
 * Assumptions:
 * - User is running this script in the web3 environment injected by Truffle.
 * - User is sending transactions from accounts[0] of the injected web3.
 * - User is using wETH as the collateral ERC20.
 * - User is referencing the ETH/USD pricefeed identifier.
 */

// Helper modules
const { toBN, toWei, fromWei, utf8ToHex, hexToUtf8 } = web3.utils;
const { interfaceName } = require("@uma/common");

const OptimisticDepositBox = artifacts.require("OptimisticDepositBox");
const WETH9 = artifacts.require("WETH9");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const OptimisticOracle = artifacts.require("OptimisticOracle");

// Constants
const priceFeedIdentifier = utf8ToHex("ETH/USD");
const liveness = 7200;
const emptyAncillaryData = "0x";

// Deploy contract and return its address.
const deploy = async () => {
  console.group("1. Deploying new OptimisticDepositBox");
  const collateral = await WETH9.deployed();
  console.log("- Using wETH as collateral token");

  // Pricefeed identifier must be whitelisted so the DVM can be used to settle disputes.
  const identifierWhitelist = await IdentifierWhitelist.deployed();
  await identifierWhitelist.addSupportedIdentifier(priceFeedIdentifier);
  console.log(`- Pricefeed identifier for ${hexToUtf8(priceFeedIdentifier)} is whitelisted`);

  // Collateral must be whitelisted for payment of final fees.
  const collateralWhitelist = await AddressWhitelist.deployed();
  await collateralWhitelist.addToWhitelist(collateral.address);
  console.log("- Collateral address for wETH is whitelisted");

  // The following steps would differ if the user is on a testnet like Kovan in the following ways:
  // - The user would not need to deploy an Optimistic Oracle and register it with the Finder.
  // - The user should pass in the zero address (i.e. 0x0) for the Timer, but using the deployed Timer
  // for testing purposes is convenient because they can advance time as needed.
  const finder = await Finder.deployed();
  const optimisticOracle = await OptimisticOracle.new(liveness, finder.address, Timer.address);
  const optimisticOracleInterfaceName = utf8ToHex(interfaceName.OptimisticOracle);
  await finder.changeImplementationAddress(optimisticOracleInterfaceName, optimisticOracle.address);
  console.log("- Deployed an OptimisticOracle");

  // Deploy a new OptimisticDepositBox contract. We pass in the collateral token address (i.e. the token
  // we will deposit into the contract), the Finder address (which stores references to all of the important
  // system contracts like the Optimistic Oracle), the pricefeed identifier we will use to pull the price of
  // our collateral (denominated in some other asset), and a Timer contract address, which is a contract
  // deployed specifically to aid time-dependent testing.
  const optimisticDepositBox = await OptimisticDepositBox.new(
    collateral.address,
    finder.address,
    priceFeedIdentifier,
    Timer.address,
    { gas: 4712388, gasPrice: 100000000000 }
  );
  console.log("- Deployed a new OptimisticDepositBox");
  console.groupEnd();
  return optimisticDepositBox.address;
};

// Set up allowances and mint collateral tokens.
const setupWallets = async (optimisticDepositBoxAddress, amountOfWethToMint) => {
  const accounts = await web3.eth.getAccounts();

  console.group("2. Minting ERC20 to user and giving OptimisticDepositBox allowance to transfer collateral");
  // This wETH contract is copied from the officially deployed wETH contract on mainnet.
  const collateral = await WETH9.deployed();

  // wETH must be converted from ETH via `deposit()`.
  await collateral.deposit({ value: amountOfWethToMint });
  console.log(`- Converted ${fromWei(amountOfWethToMint)} ETH into wETH`);
  const postBalance = await collateral.balanceOf(accounts[0]);
  console.log(`- User's wETH balance: ${fromWei(postBalance.toString())}`);

  // OptimisticDepositBox needs to be able to transfer collateral on behalf of user.
  await collateral.approve(optimisticDepositBoxAddress, amountOfWethToMint);
  console.log("- Increased OptimisticDepositBox allowance to spend wETH");
  const postAllowance = await collateral.allowance(accounts[0], optimisticDepositBoxAddress);
  console.log(`- Contract's wETH allowance: ${fromWei(postAllowance.toString())}`);

  console.groupEnd();
  return;
};

// Deposit collateral into the OptimisticDepositBox.
const deposit = async (optimisticDepositBoxAddress, amountOfWethToDeposit) => {
  const collateral = await WETH9.deployed();
  const optimisticDepositBox = await OptimisticDepositBox.at(optimisticDepositBoxAddress);
  const accounts = await web3.eth.getAccounts();

  console.group("3. Depositing ERC20 into the OptimisticDepositBox");
  await optimisticDepositBox.deposit(amountOfWethToDeposit);
  console.log(`- Deposited ${fromWei(amountOfWethToDeposit)} wETH into the OptimisticDepositBox`);

  // Let's check our deposited balance. Note that multiple users can deploy collateral into the same deposit
  // box contract, but each user (i.e. each address) has its own token balance. So, because we will be
  // depositing collateral for only one user, the "total collateral" in the OptimisticDepositBox will be equal
  // to the user's individual collateral balance.
  const userCollateral = await optimisticDepositBox.getCollateral(accounts[0]);
  const totalCollateral = await optimisticDepositBox.totalOptimisticDepositBoxCollateral();
  const userBalance = await collateral.balanceOf(accounts[0]);

  console.log(`- User's deposit balance: ${fromWei(userCollateral.toString())}`);
  console.log(`- Total deposit balance: ${fromWei(totalCollateral.toString())}`);
  console.log(`- User's wETH balance: ${fromWei(userBalance.toString())}`);

  console.groupEnd();
  return;
};

// Withdraw from OptimisticDepositBox.
const withdraw = async (optimisticDepositBoxAddress, mockPrice, amountOfUsdToWithdraw) => {
  const collateral = await WETH9.deployed();
  const optimisticDepositBox = await OptimisticDepositBox.at(optimisticDepositBoxAddress);
  const accounts = await web3.eth.getAccounts();
  const finder = await Finder.deployed();
  const optimisticOracle = await OptimisticOracle.at(
    await finder.getImplementationAddress(utf8ToHex(interfaceName.OptimisticOracle))
  );

  console.group("4. Withdrawing ERC20 from OptimisticDepositBox");

  // Withdrawing is a multi-step process.
  //
  // First, a request to withdraw must be submitted to the OptimisticDepositBox.
  // Next, someone can propose a price to the OptimisticOracle. This could even be the contract making the
  // price request.
  // Once a price is resolved, either because there were no disputes or a dispute was settled by the DVM,
  // the user of the OptimisticDepositBox can finalize the withdrawal. For test purposes, we can resolve
  // prices by calling `proposePrice` to the OptimisticOracle and then `executeWithdrawal` to the
  // OptimisticDepositBox after fast-forwarding past the liveness window.

  // Submit a withdrawal request, which sends a price request for the current timestamp to the OptimisticOracle.
  // The user wants to withdraw a USD-denominated amount of wETH.
  // Note: If the USD amount is greater than the user's deposited balance, the contract will simply withdraw
  // the full user balance.
  const requestTimestamp = await optimisticDepositBox.getCurrentTime();
  await optimisticDepositBox.requestWithdrawal(amountOfUsdToWithdraw);
  console.log(`- Submitted a withdrawal request for ${fromWei(amountOfUsdToWithdraw)} USD of wETH`);

  // Propose a price to the Optimistic Oracle for the OptimisticDepositBox contract. This price must be a
  // positive integer.
  await optimisticOracle.proposePriceFor(
    accounts[0],
    optimisticDepositBox.address,
    priceFeedIdentifier,
    requestTimestamp.toNumber(),
    emptyAncillaryData,
    mockPrice
  );
  console.log(`- Proposed a price of ${mockPrice} ETH/USD`);

  // Fast-forward until after the liveness window. This only works in test mode.
  await optimisticOracle.setCurrentTime(requestTimestamp.toNumber() + 7200);
  await optimisticDepositBox.setCurrentTime(requestTimestamp.toNumber() + 7200);
  console.log(
    "- Fast-forwarded the Optimistic Oracle and Optimistic Deposit Box to after the liveness window so we can settle."
  );
  console.log(`- New OO time is ${await optimisticOracle.getCurrentTime()}`);
  console.log(`- New ODB time is ${await optimisticDepositBox.getCurrentTime()}`);

  // The user can withdraw their requested USD amount.
  await optimisticDepositBox.executeWithdrawal();
  console.log("- Executed withdrawal. This also settles and gets the resolved price within the withdrawal function.");

  // Let's check the token balances. At an exchange rate of (1 ETH = $2000 USD) and given a requested
  // withdrawal amount of $10,000, the OptimisticDepositBox should have withdrawn ($10,000/$2000) 5 wETH.
  const userCollateral = await optimisticDepositBox.getCollateral(accounts[0]);
  const totalCollateral = await optimisticDepositBox.totalOptimisticDepositBoxCollateral();
  const userBalance = await collateral.balanceOf(accounts[0]);

  console.log(`- User's deposit balance: ${fromWei(userCollateral.toString())}`);
  console.log(`- Total deposit balance: ${fromWei(totalCollateral.toString())}`);
  console.log(`- User's wETH balance: ${fromWei(userBalance.toString())}`);

  // Note: the user can cancel their requested withdrawal via the `cancelWithdrawal()` method.

  console.groupEnd();
  return;
};

// Main script.
const main = async (callback) => {
  try {
    // Deploy
    const deployedContract = await deploy();
    console.log("\n");

    // Mint collateral
    const amountOfWethToMint = toWei(toBN(10));
    await setupWallets(deployedContract, amountOfWethToMint);
    console.log("\n");

    // Deposit collateral
    const amountOfWethToDeposit = toWei(toBN(10));
    await deposit(deployedContract, amountOfWethToDeposit);
    console.log("\n");

    // Withdraw USD denominated collateral
    const amountInUsdToWithdraw = toWei(toBN(10000)); // $10,000
    const exchangeRate = toWei(toBN(2000)); // 1 ETH = $2000
    await withdraw(deployedContract, exchangeRate, amountInUsdToWithdraw);
    console.log("\n");

    // Done!
  } catch (err) {
    console.error(err);
  }
  callback();
};

module.exports = main;
