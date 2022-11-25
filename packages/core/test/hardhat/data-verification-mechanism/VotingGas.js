const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { RegistryRolesEnum, getRandomSignedInt, computeVoteHash, signMessage } = require("@uma/common");
const { moveToNextRound, moveToNextPhase } = require("../utils/Voting.js");

const Registry = getContract("Registry");
const Voting = getContract("Voting");
const VotingInterfaceTesting = getContract("VotingInterfaceTesting");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const VotingToken = getContract("VotingToken");
const snapshotMessage = "Sign For Snapshot";
const { utf8ToHex, padRight } = web3.utils;

describe("Voting Gas Test", function () {
  let voting;
  let votingToken;
  let registry;
  let supportedIdentifiers;

  let accounts;
  let account1;
  let account2;
  let account3;
  let account4;
  let registeredContract;
  let signature;

  const setNewInflationRate = async (inflationRate) => {
    await voting.methods.setInflationRate({ rawValue: inflationRate.toString() }).send({ from: accounts[0] });
  };

  before(async function () {
    // Skip this test unless GAS_TEST=true is set.
    if (process.env.GAS_TEST !== "true") this.skip();
    accounts = await web3.eth.getAccounts();
    [account1, account2, account3, account4, registeredContract] = accounts;
    await runDefaultFixture(hre);
    voting = await VotingInterfaceTesting.at((await Voting.deployed()).options.address);

    supportedIdentifiers = await IdentifierWhitelist.deployed();
    votingToken = await VotingToken.deployed();
    registry = await Registry.deployed();

    // Allow account1 to mint tokens.
    const minterRole = 1;
    await votingToken.methods.addMember(minterRole, account1).send({ from: accounts[0] });

    // account1 starts with 100MM tokens, so divide up the tokens accordingly:
    // 1: 32MM
    // 2: 32MM
    // 3: 32MM
    // 4: 4MM (can't reach the 5% GAT alone)
    await votingToken.methods.transfer(account2, web3.utils.toWei("32000000", "ether")).send({ from: accounts[0] });
    await votingToken.methods.transfer(account3, web3.utils.toWei("32000000", "ether")).send({ from: accounts[0] });
    await votingToken.methods.transfer(account4, web3.utils.toWei("4000000", "ether")).send({ from: accounts[0] });

    // Set the inflation rate to 100.
    await setNewInflationRate(web3.utils.toWei("1", "ether"));

    // Register contract with Registry.
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, account1).send({ from: accounts[0] });
    await registry.methods.registerContract([], registeredContract).send({ from: account1 });
    signature = await signMessage(web3, snapshotMessage, account1);

    // Reset the rounds.
    await moveToNextRound(voting, accounts[0]);
  });

  function printAggregates(label, costs, voters, requests) {
    const first = costs[0];
    const last = costs[costs.length - 1];
    const max = Math.max(...costs);
    const min = Math.min(...costs);
    const sum = costs.reduce((a, b) => a + b, 0);
    const average = sum / costs.length;
    const costPerVoter = sum / voters.length;
    const costPerRequest = sum / requests.length;
    console.group(label);
    console.log(`
First: ${first}
Last: ${last}
Max: ${max}
Min: ${min}
Average: ${average}
Average Per Voter: ${costPerVoter}
Average Per Request: ${costPerRequest}
Total For All Voters: ${sum}
`);
    console.groupEnd();
  }

  async function runVoteAndPrintCosts(numRequests, numVoters, startTime) {
    if (numVoters > 4) throw new Error("Cannot have more than 4 voters");

    const identifier = padRight(utf8ToHex("gas-test"), 64);

    const requests = [];
    for (let i = 0; i < numRequests; i++) requests.push({ identifier, time: startTime + i });

    const voters = [account1, account2, account3, account4].slice(0, numVoters);

    // Make the Oracle support this identifier.
    await supportedIdentifiers.methods.addSupportedIdentifier(identifier).send({ from: accounts[0] });

    // Request a price and move to the next round where that will be voted on.
    const requestPriceCosts = await Promise.all(
      requests.map(async ({ identifier, time }) => {
        const { gasUsed } = await voting.methods.requestPrice(identifier, time).send({ from: registeredContract });
        return gasUsed;
      })
    );

    await moveToNextRound(voting, accounts[0]);
    const roundId = (await voting.methods.getCurrentRoundId().call()).toString();

    // Commit votes.
    const winningPrice = 456;
    const salt = getRandomSignedInt();

    const commitVoteCosts = await Promise.all(
      voters.map(async (voter) => {
        const commits = requests.map(({ identifier, time }) => {
          const hash = computeVoteHash({ price: winningPrice, salt, account: voter, time, roundId, identifier });
          return { hash, identifier, time, encryptedVote: "0x" };
        });
        const { gasUsed } = await voting.methods.batchCommit(commits).send({ from: voter });
        return gasUsed;
      })
    );

    // Reveal the votes.
    await moveToNextPhase(voting, accounts[0]);
    await voting.methods.snapshotCurrentRound(signature).send({ from: accounts[0] });

    const revealVoteCosts = await Promise.all(
      voters.map(async (voter) => {
        const reveals = requests.map(({ identifier, time }) => ({
          identifier,
          time,
          price: winningPrice,
          salt: salt.toString(),
        }));
        const { gasUsed } = await voting.methods.batchReveal(reveals).send({ from: voter });
        return gasUsed;
      })
    );

    // Price should resolve to the one that 2 and 3 voted for.
    await moveToNextRound(voting, accounts[0]);

    const retrieveRewardsCosts = await Promise.all(
      voters.map(async (voter) => {
        const { gasUsed } = await voting.methods.retrieveRewards(voter, roundId, requests).send({ from: voter });
        return gasUsed;
      })
    );

    const getPriceCosts = await Promise.all(
      requests.map(async ({ identifier, time }) => {
        const { gasUsed } = await voting.methods.getPrice(identifier, time).send({ from: registeredContract });
        return gasUsed;
      })
    );

    console.group(`Gas costs for ${numVoters} voters, ${numRequests} requests\n`);
    printAggregates("Request Price", requestPriceCosts, voters, requests);
    printAggregates("Commit", commitVoteCosts, voters, requests);
    printAggregates("Reveal", revealVoteCosts, voters, requests);
    printAggregates("RetrieveRewards", retrieveRewardsCosts, voters, requests);
    printAggregates("Get Price", getPriceCosts, voters, requests);
    printAggregates(
      "Total Lifecycle (only voting methods)",
      [...commitVoteCosts, ...revealVoteCosts, ...retrieveRewardsCosts],
      voters,
      requests
    );
    console.groupEnd();
  }

  it("Four voter gas test", async function () {
    // Initialize Run
    console.log("\n\nInitialize Run. Gas costs will likely be higher than typical\n");
    await runVoteAndPrintCosts(4, 4, 1000);

    await moveToNextRound(voting, accounts[0]);

    console.log("\n\nSteady state run. Gas costs should be normal.\n");
    await runVoteAndPrintCosts(4, 4, 5000);
  });
});
