const Voting = artifacts.require("Voting");
const EncryptedSender = artifacts.require("EncryptedSender");
const { VotePhasesEnum } = require("../utils/Enums");
const { decryptMessage, encryptMessage } = require("../utils/Crypto");

// TODO(#492): Implement price fetching logic.
async function fetchPrice(request) {
  return web3.utils.toWei("1.5");
}

class VotingSystem {
  constructor(voting, encryptedSender, account) {
    this.voting = voting;
    this.encryptedSender = encryptedSender;
    this.account = account;
  }

  async readVote(request, roundId) {
    const encryptedCommit = await this.encryptedSender.getMessage(
      this.account,
      this.computeTopicHash(request, roundId)
    );

    if (!encryptedCommit) {
      // Nothing has been published for this topic.
      return null;
    }

    const { privKey } = this.getAccountKeys();
    const decryptedMessage = await decryptMessage(privKey, encryptedCommit);
    return JSON.parse(decryptedMessage);
  }

  async writeVote(request, roundId, vote) {
    // TODO: if we want to authorize other accounts to send messages to the automated voting system, we should check
    // and authorize them here.

    // Get the account's public key from the encryptedSender.
    let pubKey = await this.encryptedSender.getPublicKey(this.account);

    if (!pubKey) {
      // If the public key isn't published, pull it from the local wallet.
      pubKey = this.getAccountKeys().pubKey;

      // Publish the public key so dApps or scripts that are authorized can write without direct access to this
      // account's private key.
      await this.encryptedSender.setPublicKey(pubKey, { from: this.account });
    }

    // Encrypt the vote using the public key.
    const encryptedMessage = await encryptMessage(pubKey, JSON.stringify(vote));

    // Upload the encrypted commit.
    const topicHash = this.computeTopicHash(request, roundId);
    await this.encryptedSender.sendMessage(this.account, topicHash, encryptedMessage, { from: this.account });
  }

  async runCommit(request, roundId) {
    const persistedVote = await this.readVote(request, roundId);
    // If the vote has already been persisted and committed, we don't need to recommit.
    // TODO: we may want to add a feature in the future where we ensure that the persisted vote matches the commit, and
    // if it does not, we commit the persisted vote.
    if (persistedVote) {
      return;
    }
    const fetchedPrice = await fetchPrice(request);
    const salt = web3.utils.toBN(web3.utils.randomHex(32));

    const hash = web3.utils.soliditySha3(fetchedPrice, salt);
    await this.voting.commitVote(request.identifier, request.time, hash, { from: this.account });

    // Persist the vote only after the commit hash has been sent to the Voting contract.
    await this.writeVote(request, roundId, { price: fetchedPrice.toString(), salt: salt.toString() });
  }

  async runReveal(request, roundId) {
    const persistedVote = await this.readVote(request, roundId);
    // If no vote was persisted and committed, then we can't reveal.
    if (persistedVote) {
      await this.voting.revealVote(request.identifier, request.time, persistedVote.price, persistedVote.salt, {
        from: this.account
      });
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

  computeTopicHash(request, roundId) {
    return web3.utils.soliditySha3(request.identifier, request.time, roundId);
  }

  getAccountKeys() {
    // Note: this assumes that current provider has a .wallets field that is keyed by wallet address.
    // Each wallet in the wallets field is assumed to have ._privKey and ._pubKey fields that store buffers holding the
    // keys.
    const wallet = web3.currentProvider.wallets[this.account];
    return {
      privKey: wallet._privKey.toString("hex"),
      // Note: the "0x" addition is because public keys are expected to be passed in a web3 friendly format.
      pubKey: "0x" + wallet._pubKey.toString("hex")
    };
  }
}

async function runVoting() {
  try {
    console.log("Running Voting system");
    const voting = await Voting.deployed();
    const encryptedSender = await EncryptedSender.deployed();
    const account = (await web3.eth.getAccounts())[0];
    const votingSystem = new VotingSystem(voting, encryptedSender, account);
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
