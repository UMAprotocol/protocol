const Voting = artifacts.require("Voting");
const { VotePhasesEnum } = require("../utils/Enums");

// TODO(#492): Implement price fetching logic.
async function fetchPrice(request) {
  return web3.utils.toWei("1.5");
}

// TODO(#493): Implement persistance.
class VotingSystem {
  constructor(voting, persistence) {
    this.voting = voting;
    this.persistence = persistence;
  }

  async runCommit(request, roundId) {
    const persistedVote = this.persistence[{ request, roundId }];
    // If the vote has already been persisted and committed, we don't need to recommit.
    if (persistedVote) {
      return;
    }
    const fetchedPrice = await fetchPrice(request);
    const salt = web3.utils.toBN(web3.utils.randomHex(32));

    this.persistence[{ request, roundId }] = { price: fetchedPrice, salt: salt };
    const hash = web3.utils.soliditySha3(fetchedPrice, salt);
    await this.voting.commitVote(request.identifier, request.time, hash);
  }

  async runReveal(request, roundId) {
    const persistedVote = this.persistence[{ request, roundId }];
    // If no vote was persisted and committed, then we can't reveal.
    if (persistedVote) {
      await this.voting.revealVote(request.identifier, request.time, persistedVote.price, persistedVote.salt);
      delete this.persistence[{ request, roundId }];
    }
  }

  async runIteration() {
    const phase = await this.voting.getVotePhase();
    const roundId = await this.voting.getCurrentRoundId();
    const pendingRequests = await this.voting.getPendingRequests();
    for (const request of pendingRequests) {
      if (phase == VotePhasesEnum.COMMIT) {
        await this.runCommit(request, roundId);
      } else {
        await this.runReveal(request, roundId);
      }
    }
  }
}

async function runVoting() {
  try {
    const voting = await Voting.deployed();
    const votingSystem = new VotingSystem(voting, {});
    await votingSystem.runIteration();
  } catch (error) {
    console.log(error);
  }
}

run = async function(callback) {
  await runVoting();
  callback();
};
run.VotingSystem = VotingSystem;
module.exports = run;
