const Voting = artifacts.require("Voting");
const { VotePhasesEnum } = require("../utils/Enums");
const sendgrid = require("@sendgrid/mail");

// TODO(#492): Implement price fetching logic.
async function fetchPrice(request) {
  return web3.utils.toWei("1.5");
}

class EmailSender {
  async sendEmailNotification(subject, body) {
    await sendgrid.send({
      to: process.env.NOTIFICATION_TO_ADDRESS,
      from: process.env.NOTIFICATION_FROM_ADDRESS,
      subject,
      text: body
    });
  }
}

// TODO(#493): Implement persistance.
class VotingSystem {
  constructor(voting, persistence, emailSender) {
    this.voting = voting;
    this.persistence = persistence;
    this.emailSender = emailSender;
  }

  async runCommit(request, roundId) {
    const persistedVote = this.persistence[{ request, roundId }];
    // If the vote has already been persisted and committed, we don't need to recommit.
    if (persistedVote) {
      return false;
    }
    const fetchedPrice = await fetchPrice(request);
    const salt = web3.utils.toBN(web3.utils.randomHex(32));

    this.persistence[{ request, roundId }] = { price: fetchedPrice, salt: salt };
    const hash = web3.utils.soliditySha3(fetchedPrice, salt);
    await this.voting.commitVote(request.identifier, request.time, hash);
    return true;
  }

  async runReveal(request, roundId) {
    const persistedVote = this.persistence[{ request, roundId }];
    // If no vote was persisted and committed, then we can't reveal.
    if (!persistedVote) {
      return false;
    }
    await this.voting.revealVote(request.identifier, request.time, persistedVote.price, persistedVote.salt);
    delete this.persistence[{ request, roundId }];
    return true;
  }

  async runIteration() {
    const phase = await this.voting.getVotePhase();
    const roundId = await this.voting.getCurrentRoundId();
    const pendingRequests = await this.voting.getPendingRequests();
    const updatesMade = [];
    for (const request of pendingRequests) {
      let didUpdate = false;
      if (phase == VotePhasesEnum.COMMIT) {
        didUpdate = await this.runCommit(request, roundId);
      } else {
        didUpdate = await this.runReveal(request, roundId);
      }
      if (didUpdate) {
        updatesMade.push(request);
      }
    }
    if (updatesMade.length > 0) {
      // TODO(ptare): Get email copies.
      await this.emailSender.sendEmailNotification(
        "Automated voting system update",
        "Updated " + updatesMade.length + " price requests"
      );
    }
  }
}

async function runVoting() {
  try {
    console.log("Running Voting system");
    sendgrid.setApiKey(process.env.SENDGRID_API_KEY);

    const voting = await Voting.deployed();
    const votingSystem = new VotingSystem(voting, {}, new EmailSender());
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
