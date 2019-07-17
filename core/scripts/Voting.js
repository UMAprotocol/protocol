const Voting = artifacts.require("Voting");
const { VotePhasesEnum } = require("../../common/Enums");
const { decryptMessage, encryptMessage, deriveKeyPairFromSignature } = require("../../common/Crypto");
const { computeTopicHash, getKeyGenMessage } = require("../utils/EncryptionHelper");
const sendgrid = require("@sendgrid/mail");
const fetch = require("node-fetch");
require("dotenv").config();

const SUPPORTED_IDENTIFIERS = {
  BTCUSD: {
    dataSource: "CryptoCompare",
    identifiers: { first: "BTC", second: "USD" }
  }
};

const CC_API_KEY = process.env.CRYPTO_COMPARE_API_KEY
  ? process.env.CRYPTO_COMPARE_API_KEY
  : "6a5293dbbe836ea20b8bda991ee031443e7a4fe936afd8293f6985d358c1d2fc";

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
  // CryptoCompare provides historical hourly prices for free. If we want minutes/seconds, we'll have to update later.
  const url = `https://min-api.cryptocompare.com/data/histohour?fsym=${identifier.first}&tsym=${identifier.second}&toTs=${time}&limit=1&api_key=${CC_API_KEY}`;
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

  return web3.utils.toWei(price.toString());
}

async function fetchPrice(request) {
  const plainTextIdentifier = web3.utils.hexToUtf8(request.identifier);
  if (plainTextIdentifier.startsWith("test")) {
    return web3.utils.toWei("1.5");
  }
  const config = SUPPORTED_IDENTIFIERS[plainTextIdentifier];
  switch (config.dataSource) {
    case "CryptoCompare":
      return await fetchCryptoComparePrice({
        identifier: { first: config.identifiers.first, second: config.identifiers.second },
        time: request.time
      });
    default:
      throw "No known data source specified";
  }
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
  constructor(voting, account, emailSender) {
    this.voting = voting;
    this.account = account;
    this.emailSender = emailSender;
  }

  async getMessage(request, roundId) {
    const topicHash = computeTopicHash(request, roundId);
    return await this.voting.getMessage(this.account, topicHash, { from: this.account });
  }

  async constructCommitment(request, roundId) {
    const fetchedPrice = await fetchPrice(request);
    const salt = web3.utils.toBN(web3.utils.randomHex(32));
    const hash = web3.utils.soliditySha3(fetchedPrice, salt);

    const vote = { price: fetchedPrice, salt };
    const { publicKey } = await deriveKeyPairFromSignature(web3, getKeyGenMessage(roundId), this.account);
    const encryptedVote = await encryptMessage(publicKey, JSON.stringify(vote));

    return {
      identifier: request.identifier,
      time: request.time,
      hash,
      encryptedVote
    };
  }

  async runBatchCommit(requests, roundId) {
    const commitments = [];

    for (let i = 0; i < requests.length; i++) {
      // Skip commits if a message already exists for this request.
      // This does not check the existence of an actual commit.
      if (await this.getMessage(requests[i], roundId)) {
        continue;
      }

      commitments.push(await this.constructCommitment(requests[i], roundId));
    }

    // Always call `batchCommit`, even if there's only one commitment. Difference in gas cost is negligible.
    await this.voting.batchCommit(commitments, { from: this.account });

    return commitments.length;
  }

  async constructReveal(request, roundId) {
    const encryptedCommit = await this.getMessage(request, roundId);

    let vote;

    // Catch messages that are indecipherable and handle by skipping over the request.
    try {
      const { privateKey } = await deriveKeyPairFromSignature(web3, getKeyGenMessage(roundId), this.account);
      vote = JSON.parse(await decryptMessage(privateKey, encryptedCommit));
    } catch (e) {
      console.error("Failed to decrypt message:", encryptedCommit, "\n", e);
      return null;
    }

    return {
      identifier: request.identifier,
      time: request.time,
      price: vote.price.toString(),
      salt: web3.utils.hexToNumberString(vote.salt)
    };
  }

  async runBatchReveal(requests, roundId) {
    const reveals = [];

    let reveal;
    for (let i = 0; i < requests.length; i++) {
      const encryptedCommit = await this.getMessage(requests[i], roundId);
      if (!encryptedCommit) {
        continue;
      }

      reveal = await this.constructReveal(requests[i], roundId);
      if (reveal) {
        reveals.push(reveal);
      }
    }

    // Always call `batchReveal`, even if there's only one reveal.
    await this.voting.batchReveal(reveals, { from: this.account });
    return reveals.length;
  }

  async runIteration() {
    console.log("Starting voting iteration");
    const phase = await this.voting.getVotePhase();
    const roundId = await this.voting.getCurrentRoundId();
    const pendingRequests = await this.voting.getPendingRequests();

    let numUpdates = 0;
    if (phase == VotePhasesEnum.COMMIT) {
      numUpdates = await this.runBatchCommit(pendingRequests, roundId);
    } else {
      numUpdates = await this.runBatchReveal(pendingRequests, roundId);
    }

    if (numUpdates > 0) {
      // TODO(ptare): Add granular email notifications.
      await this.emailSender.sendEmailNotification(
        "Automated voting system update",
        "Updated " + numUpdates + " price requests"
      );
    }

    console.log("Finished voting iteration");
  }
}

async function runVoting() {
  try {
    console.log("Running Voting system");
    sendgrid.setApiKey(process.env.SENDGRID_API_KEY);
    const voting = await Voting.deployed();
    const account = (await web3.eth.getAccounts())[0];
    const votingSystem = new VotingSystem(voting, account, new EmailSender());
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
