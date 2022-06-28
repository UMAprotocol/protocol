const hre = require("hardhat");
const { web3 } = hre;
const { runVotingV2Fixture } = require("@uma/common");
const { getContract, assertEventEmitted, assertEventNotEmitted } = hre;
const {
  RegistryRolesEnum,
  VotePhasesEnum,
  didContractThrow,
  getRandomSignedInt,
  decryptMessage,
  encryptMessage,
  deriveKeyPairFromSignatureTruffle,
  computeVoteHash,
  computeVoteHashAncillary,
  getKeyGenMessage,
} = require("@uma/common");
const { moveToNextRound, moveToNextPhase } = require("../../utils/Voting.js");
const { assert } = require("chai");
const { toBN } = web3.utils;

const Finder = getContract("Finder");
const Registry = getContract("Registry");
const VotingV2 = getContract("VotingV2");
const VotingInterfaceTesting = getContract("VotingInterfaceTesting");
const VotingAncillaryInterfaceTesting = getContract("VotingAncillaryInterfaceTesting");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const VotingToken = getContract("VotingToken");
const VotingTest = getContract("VotingTest");
const Timer = getContract("Timer");
const { utf8ToHex, padRight } = web3.utils;

const toWei = (value) => toBN(web3.utils.toWei(value, "ether"));

// These gas specific tests are kept severalty as they are not intended to be run with the normal unit tests due to being
// slow and producing console log outputs.
describe("VotingV2Gas", function () {
  let voting, votingToken, registry, supportedIdentifiers, registeredContract, unregisteredContract, migratedVoting;
  let accounts, account1, account2, account3, account4;

  beforeEach(async function () {
    accounts = await web3.eth.getAccounts();
    [account1, account2, account3, account4, registeredContract, unregisteredContract, migratedVoting] = accounts;
    await runVotingV2Fixture(hre);
    voting = await await VotingV2.deployed();

    supportedIdentifiers = await IdentifierWhitelist.deployed();
    votingToken = await VotingToken.deployed();
    registry = await Registry.deployed();

    // Allow account1 to mint tokens.
    const minterRole = 1;
    await votingToken.methods.addMember(minterRole, account1).send({ from: accounts[0] });

    // Seed the three accounts and stake into the voting contract.  account1 starts with 100MM tokens, so divide up as:
    // 1: 32MM
    // 2: 32MM
    // 3: 32MM
    // 4: 4MM (can't reach the 5% GAT alone)
    await votingToken.methods.approve(voting.options.address, toWei("32000000")).send({ from: account1 });
    await voting.methods.stake(toWei("32000000")).send({ from: account1 });
    await votingToken.methods.transfer(account2, toWei("32000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("32000000")).send({ from: account2 });
    await voting.methods.stake(toWei("32000000")).send({ from: account2 });
    await votingToken.methods.transfer(account3, toWei("32000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("32000000")).send({ from: account3 });
    await voting.methods.stake(toWei("32000000")).send({ from: account3 });
    await votingToken.methods.transfer(account4, toWei("4000000")).send({ from: accounts[0] });
    await votingToken.methods.approve(voting.options.address, toWei("4000000")).send({ from: account4 });
    await voting.methods.stake(toWei("4000000")).send({ from: account4 });

    // Set the inflation rate to 0 by default, so the balances stay fixed until inflation is tested.

    // Register contract with Registry.
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, account1).send({ from: accounts[0] });
    await registry.methods.registerContract([], registeredContract).send({ from: account1 });

    // Reset the rounds.
    await moveToNextRound(voting, accounts[0]);
  });

  it("Can accommodate many price requests", async function () {
    // Iteratively request many price requests in one block and attempt to exceed the single gas limit for the slashing
    // operations. In particular, each request within a voting cycle requires a separate slashing action. validate that
    // we can accommodate many of these (upwards of 1500 requests).
    const identifier = padRight(utf8ToHex("slash-test"), 64);
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });
    const iterationsToRun = 100;
    for (let time = 1; time < iterationsToRun; time++) {
      console.log("timea", time);
      const tx = await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
      console.log("request gas", tx.gasUsed);
    }

    await moveToNextRound(voting, accounts[0]);

    // Commit votes. Vote correctly from one gat-reaching account and one non-gat reaching account.
    const winningPrice = 123;
    const loosingPrice = 321;
    const salt = getRandomSignedInt();
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
    const hash = computeVoteHash({ price: winningPrice, salt, account: account1, time: 1, roundId, identifier });
    const tx1 = await voting.methods.commitVote(identifier, 1, hash).send({ from: account1 });
    const tx2 = await voting.methods.commitVote(identifier, 1, hash).send({ from: account1 });

    const hash2 = computeVoteHash({ price: winningPrice, salt, account: account4, time: 1, roundId, identifier });
    const tx3 = await voting.methods.commitVote(identifier, 1, hash2).send({ from: account4 });
    const tx4 = await voting.methods.commitVote(identifier, 1, hash2).send({ from: account4 });

    console.log("gas used", tx1.gasUsed, tx2.gasUsed, tx3.gasUsed, tx4.gasUsed);

    for (let time = 1; time < iterationsToRun; time++) {
      const roundId = (await voting.methods.getCurrentRoundId().call()).toString();
      console.log("roundIdzxzzz", roundId.toString());
      console.log("timeb", time);
      const account1Hash = computeVoteHash({ price: winningPrice, salt, account: account1, time, roundId, identifier });
      const tx = await voting.methods.commitVote(identifier, time, account1Hash).send({ from: account1 });
      console.log("commit1", tx.gasUsed);

      const account4Hash = computeVoteHash({ price: loosingPrice, salt, account: account4, time, roundId, identifier });
      const tx2 = await voting.methods.commitVote(identifier, time, account4Hash).send({ from: account4 });
      console.log("commit2", tx2.gasUsed);
    }

    await moveToNextPhase(voting, accounts[0]);
    for (let time = 1; time < iterationsToRun; time++) {
      console.log("timec", time);
      const tx1 = await voting.methods.revealVote(identifier, time, winningPrice, salt).send({ from: account1 });
      console.log("gas used1", tx1.gasUsed);
      const tx2 = await voting.methods.revealVote(identifier, time, loosingPrice, salt).send({ from: account4 });
      console.log("gas used2", tx2.gasUsed);
    }
  });
});
