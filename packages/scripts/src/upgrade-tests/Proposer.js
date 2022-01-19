#!/usr/bin/env node

// Run:
//    - Run a fork in a separate terminal:
//      HARDHAT_CHAIN_ID=1 yarn hardhat node --fork <fork url here> --no-deploy --port 9545
//    - Run the script (assuming you're running from the root of the scripts package):
//      CUSTOM_NODE_ULR=http://localhost:9545 HARDHAT_NETWORK=mainnet ./src/upgrade-tests/Proposer.js

const hre = require("hardhat");
const Web3 = require("web3");

// Create our own web3 to work around this hardhat bug: https://github.com/nomiclabs/hardhat/issues/1226.
hre.web3 = new Web3(process.env.CUSTOM_NODE_URL);
const { getContract, web3 } = hre;
const { ZERO_ADDRESS } = require("@uma/common");
const assert = require("assert");
require("dotenv").config();
const argv = require("minimist")(process.argv.slice(), {
  string: [
    // proposer address.
    "proposer",
  ],
});

const { simulateVote } = require("../admin-proposals/simulateVote");

async function main() {
  // Note: there are no default accounts, so all must be impersonated.
  // This creates a random account as the default.
  const defaultAccount = web3.utils.randomHex(20);
  await addEth(defaultAccount);
  await impersonateAccount(defaultAccount);

  // Get contracts.
  const Governor = getContract("Governor");
  const Proposer = getContract("Proposer");
  const VotingToken = getContract("VotingToken");
  const Finder = getContract("Finder");
  const IdentifierWhitelist = getContract("IdentifierWhitelist");

  const governor = await Governor.deployed();
  const votingToken = await VotingToken.deployed();

  // Deploy the proposer if not deployed.
  let proposer;
  if (argv.proposer) {
    proposer = Proposer.at(argv.proposer);
  } else {
    const votingToken = await VotingToken.deployed();
    const finder = await Finder.deployed();
    proposer = await Proposer.new(
      votingToken.options.address,
      web3.utils.toWei("5000"),
      governor.options.address,
      finder.options.address,
      ZERO_ADDRESS
    ).send({ from: defaultAccount });
  }

  // Grab the current owner and proposer accounts from the governor.
  const governorOwner = await governor.methods.getMember(0).call();
  const governorProposer = await governor.methods.getMember(1).call();

  // As with other accounts, the owner account will need to be given ETH and impersonated.
  await addEth(governorOwner);
  await impersonateAccount(governorOwner);

  // Random large UMA holder (EOA). This account will be used as a source of UMA.
  const largeHolder = "0x8bd16DE8938A2ad16794ac7E7502896f156E370C";
  await impersonateAccount(largeHolder);

  // Do upgrade to decentralized proposal system.
  await governor.methods.resetMember(1, proposer.options.address).send({ from: governorOwner });
  await governor.methods.resetMember(0, governor.options.address).send({ from: governorOwner });

  // Send 10k tokens to the default account so it can make two proposals.
  await votingToken.methods.transfer(defaultAccount, web3.utils.toWei("10000")).send({ from: largeHolder });

  // Approve the proposal contract to take 10k tokens from the default wallet.
  await votingToken.methods.approve(proposer.options.address, web3.utils.toWei("10000")).send({ from: defaultAccount });

  // Create whitelist transaction as a test.
  const identifierWhitelist = await IdentifierWhitelist.deployed();
  const identifier = web3.utils.padRight(web3.utils.utf8ToHex("TestIdentifier"), 64);
  const whitelistTxnData = identifierWhitelist.methods.addSupportedIdentifier(identifier).encodeABI();

  // Propose the sample transaction and simulate a vote.
  await proposer.methods
    .propose([{ to: identifierWhitelist.options.address, value: 0, data: whitelistTxnData }])
    .send({ from: defaultAccount });
  await simulateVote();

  // Verify that the transaction went through.
  assert(
    await identifierWhitelist.methods.isIdentifierSupported(identifier).call(),
    "❌ Initial test transaction didn't go through!"
  );

  console.log("✅ Test proposal went through using new proposal system.");

  // Make a proposal to reset the governor permissions to how they started.
  const resetPermissionsProposal = [
    { to: governor.options.address, data: governor.methods.resetMember(1, governorProposer).encodeABI(), value: 0 },
    { to: governor.options.address, data: governor.methods.resetMember(0, governorOwner).encodeABI(), value: 0 },
  ];

  await proposer.methods.propose(resetPermissionsProposal).send({ from: defaultAccount });
  await simulateVote();

  assert(
    (await governor.methods.getMember(0).call()) === governorOwner,
    "❌ Owner wasn't set reset. Revert proposal wasn't successful."
  );
  assert(
    (await governor.methods.getMember(1).call()) === governorProposer,
    "❌ Proposer not reset. Revert proposal wasn't successful."
  );

  console.log("✅ Proposal to revert upgrade to decentralized proposal system succeded.");
}

async function impersonateAccount(account) {
  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [account] });
}

async function addEth(account) {
  await hre.network.provider.send("hardhat_setBalance", [account, "0x8AC7230489E80000"]);
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
