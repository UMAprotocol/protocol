// Description:
// - Transfer UMA tokens from the Governor to a specified address on Ethereum. The transfer amount and recipient are configurable.
// Note: The verification logic only makes sense if the recipient did not previously have UMA tokens.
// TODO: Write a better verification script and allow transfer of any token, not just UMA.

// Run:
// - Check out README.md in this folder for setup instructions and simulating votes between the Propose and Verify
//   steps.
// - Propose: node ./packages/scripts/src/admin-proposals/transferTokensFromGovernor.js --amount 123 --recipient 0xdef --network mainnet-fork
// - Verify: Add --verify flag to Propose command.

const hre = require("hardhat");
require("dotenv").config();
const Web3 = require("web3");
const { toWei } = Web3.utils;
const { getContract } = hre;
const { _getContractAddressByName } = require("../utils/index.js");
const { setupGasEstimator, proposeAdminTransactions } = require("./utils");
const { getWeb3ByChainId } = require("@uma/common");
const { REQUIRED_SIGNER_ADDRESSES } = require("../utils/constants");
const argv = require("minimist")(process.argv.slice(), {
  string: ["amount", "recipient"],
  boolean: [
    // set True if verifying, False for proposing.
    "verify",
  ],
  default: { verify: false },
});

const ExpandedERC20 = getContract("ExpandedERC20");

async function run() {
  const { recipient, amount, verify } = argv;
  const web3Providers = { 1: getWeb3ByChainId(1) }; // netID => Web3
  const web3 = web3Providers[1];
  const tokenAddress = await _getContractAddressByName("VotingToken", 1);
  const governorAddress = await _getContractAddressByName("Governor", 1);
  console.log("tokenAddress:", tokenAddress);
  const uma = new web3.eth.Contract(ExpandedERC20.abi, tokenAddress);

  const gasEstimator = await setupGasEstimator();

  if (!verify) {
    let originalBalance, originalGovernorBalance;
    try {
      [originalBalance, originalGovernorBalance] = await Promise.all([
        uma.methods.balanceOf(recipient).call(),
        uma.methods.balanceOf(governorAddress).call(),
      ]);
    } catch (error) {
      console.log("error fetching balances:", error);
    }

    console.log("Original balance of recipient:", originalBalance);
    console.log("Original balance of Governor:", originalGovernorBalance);

    console.group(`🟢 Proposing transfer of ${amount} UMA tokens to ${recipient}`);
    const adminProposalTransactions = [];
    const transferUmaData = uma.methods.transfer(recipient, toWei(amount)).encodeABI();
    console.log("- transfer tokens", transferUmaData);
    adminProposalTransactions.push({ to: uma.options.address, value: 0, data: transferUmaData });

    // Send the proposal
    await proposeAdminTransactions(
      web3Providers[1],
      adminProposalTransactions,
      REQUIRED_SIGNER_ADDRESSES["deployer"],
      gasEstimator.getCurrentFastPrice()
    );
    console.groupEnd();
    console.log("\nTransactions proposed!");
  } else {
    let balance, governorBalance;
    try {
      [balance, governorBalance] = await Promise.all([
        uma.methods.balanceOf(recipient).call(),
        uma.methods.balanceOf(governorAddress).call(),
      ]);
    } catch (error) {
      console.log("error fetching balances:", error);
    }
    console.log("New balance of recipient:", balance);
    console.log("New balance of Governor:", governorBalance);

    console.group("\n🔎 Verifying execution of Admin Proposal");
    console.log(`- Recipient @ ${recipient} received ${amount} UMA`);
    console.groupEnd();
    console.log("\n😇 Success!");
  }
}

function main() {
  const startTime = Date.now();
  run()
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      const timeElapsed = Date.now() - startTime;
      console.log(`Done in ${(timeElapsed / 1000).toFixed(2)}s`);
    });
}
main();
