const Voting = artifacts.require("Voting");
const EncryptedSender = artifacts.require("EncryptedSender");
const { VotePhasesEnum } = require("../utils/Enums");
const { decryptMessage, encryptMessage, deriveKeyPairFromSignature } = require("../utils/Crypto");
const sendgrid = require("@sendgrid/mail");

const fetch = require("node-fetch");

function stripApiKey(str, key) {
  return str.replace(key, "{redacted}");
}

// Gets JSON from a URL or throws.
const getJson = async url => {
  const response = await fetch(url);
  const json = await response.json();
  if (!json) {
    throw `Query [${url}] failed to get JSON`;
  }
  return json;
};

async function fetchCryptoComparePrice(request) {
  const identifier = request.identifier;
  const time = request.time;

  // Temporary price feed until we sort historical data.
  const url = `https://min-api.cryptocompare.com/data/histohour?fsym=${identifier.first}&tsym=${identifier.second}&limit=3`;
  console.log(`\n    ***** \n Querying with [${url}]\n    ****** \n`);
  const jsonOutput = await getJson(url);
  console.log(`Response [${JSON.stringify(jsonOutput)}]`);

  if (jsonOutput.Type != "100") {
    throw "Request failed";
  }

  if (jsonOutput.Data == null) {
    throw "Unexpected number of results in json response";
  }

  const price = jsonOutput.Data[0].open;
  if (!price) {
    throw "Failed to get valid price out of JSON response";
  }

  const tradeTime = jsonOutput.Data[0].time;
  console.log(`Retrieved quote [${price}] at [${tradeTime}] for asset [${identifier.first}${identifier.second}]`);

  return { price };
}

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

class VotingSystem {
  constructor(voting, encryptedSender, account, emailSender) {
    this.voting = voting;
    this.encryptedSender = encryptedSender;
    this.account = account;
    this.emailSender = emailSender;
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

    // Generate the one-time keypair for this round.
    const { privateKey } = await deriveKeyPairFromSignature(web3, this.getKeyGenMessage(roundId), this.account);

    // Decrypt message.
    const decryptedMessage = await decryptMessage(privateKey, encryptedCommit);
    return JSON.parse(decryptedMessage);
  }

  async writeVote(request, roundId, vote) {
    // TODO: if we want to authorize other accounts to send messages to the automated voting system, we should check
    // and authorize them here.

    // Generate the one-time keypair for this round.
    const { publicKey } = await deriveKeyPairFromSignature(web3, this.getKeyGenMessage(roundId), this.account);

    // Encrypt the vote using the public key.
    const encryptedMessage = await encryptMessage(publicKey, JSON.stringify(vote));

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
      return false;
    }
    const fetchedPrice = await fetchPrice(request);
    const salt = web3.utils.toBN(web3.utils.randomHex(32));

    const hash = web3.utils.soliditySha3(fetchedPrice, salt);
    await this.voting.commitVote(request.identifier, request.time, hash, { from: this.account });

    // Persist the vote only after the commit hash has been sent to the Voting contract.
    await this.writeVote(request, roundId, { price: fetchedPrice.toString(), salt: salt.toString() });
    return true;
  }

  async runReveal(request, roundId) {
    const persistedVote = await this.readVote(request, roundId);
    // If no vote was persisted and committed, then we can't reveal.
    if (!persistedVote) {
      return false;
    }
    const hasRevealedVote = await this.voting.hasRevealedVote(request.identifier, request.time, { from: this.account });
    // If we've already revealed, no need to re-reveal.
    if (hasRevealedVote) {
      return false;
    }
    await this.voting.revealVote(request.identifier, request.time, persistedVote.price, persistedVote.salt, {
      from: this.account
    });
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

  computeTopicHash(request, roundId) {
    return web3.utils.soliditySha3(request.identifier, request.time, roundId);
  }

  getKeyGenMessage(roundId) {
    // TODO: discuss dApp tradeoffs for changing this to a per-topic hash keypair.
    return `UMA Protocol one time key for round: ${roundId.toString()}`;
  }
}

async function runVoting() {
  try {
    console.log("Running Voting system");
    sendgrid.setApiKey(process.env.SENDGRID_API_KEY);

    const voting = await Voting.deployed();
    const encryptedSender = await EncryptedSender.deployed();
    const account = (await web3.eth.getAccounts())[0];
    const votingSystem = new VotingSystem(voting, encryptedSender, account, new EmailSender());
    await votingSystem.runIteration();
  } catch (error) {
    console.log(error);
  }
}

run = async function(callback) {
  var request = { identifier: { first: "BTC", second: "USD" }, time: "1560762000" };
  await runVoting();
  await fetchPrice(request);
  await fetchCryptoComparePrice(request);
  callback();
};
run.VotingSystem = VotingSystem;
module.exports = run;
