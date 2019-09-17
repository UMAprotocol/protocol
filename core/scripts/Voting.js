const Voting = artifacts.require("Voting");
const { VotePhasesEnum } = require("../../common/Enums");
const { decryptMessage, encryptMessage, deriveKeyPairFromSignatureTruffle } = require("../../common/Crypto");
const { computeTopicHash, getKeyGenMessage } = require("../../common/EncryptionHelper");
const publicNetworks = require("../../common/PublicNetworks");
const sendgrid = require("@sendgrid/mail");
const fetch = require("node-fetch");
require("dotenv").config();
const gmailSend = require("gmail-send")();

const argv = require("minimist")(process.argv.slice(), { string: ["network"] });

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

// Returns an html link to the transaction.
// If the network is not recognized/not public, just returns the txn hash in plaintext.
function getTxnLink(txnHash) {
  const networkConfig = publicNetworks[Voting.network_id];
  if (networkConfig && networkConfig.etherscan) {
    // If there is an etherscan link, add it to the txn hash element.
    const url = `${networkConfig.etherscan}tx/${txnHash}`;
    return `<a href="${url}">${txnHash}</a>`;
  }

  // If there is no etherscan link, just return the plaintext txnHash.
  return txnHash;
}

function getNotifiers() {
  const notifiers = [];

  // Add email notifier.
  if (process.env.GMAIL_USERNAME && process.env.GMAIL_API_PW) {
    // Prefer gmail over sendgrid if env variables are available because gmail doesn't spoof the sender.
    notifiers.push(new GmailNotifier());
  } else if (process.env.SENDGRID_API_KEY) {
    notifiers.push(new SendgridNotifier());
  } else {
    throw new Error("User did not pass any valid email credentials");
  }

  // Add a standard console notifier.
  notifiers.push(new ConsoleNotifier());

  return notifiers;
}

class ConsoleNotifier {
  async sendNotification(subject, body) {
    console.log(`Notification subject: ${subject}`);
    console.log(`Notification body: ${body}`);
  }
}

class GmailNotifier {
  async sendNotification(subject, body) {
    // Note: wrap gmail send in a promise since it uses a callback to notify when done.
    await new Promise((resolve, reject) => {
      gmailSend(
        {
          user: process.env.GMAIL_USERNAME,
          pass: process.env.GMAIL_API_PW,
          to: process.env.NOTIFICATION_TO_ADDRESS ? process.env.NOTIFICATION_TO_ADDRESS : process.env.GMAIL_USERNAME,
          subject,
          html: body
        },
        (err, res) => {
          if (err) {
            reject(err);
          } else {
            resolve(res);
          }
        }
      );
    });
  }
}

class SendgridNotifier {
  async sendNotification(subject, body) {
    await sendgrid.send({
      to: process.env.NOTIFICATION_TO_ADDRESS,
      from: process.env.NOTIFICATION_FROM_ADDRESS,
      subject,
      html: body
    });
  }
}

class VotingSystem {
  constructor(voting, account, notifiers) {
    this.voting = voting;
    this.account = account;
    this.notifiers = notifiers;
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
    const { publicKey } = await deriveKeyPairFromSignatureTruffle(web3, getKeyGenMessage(roundId), this.account);
    const encryptedVote = await encryptMessage(publicKey, JSON.stringify(vote));

    return {
      identifier: request.identifier,
      time: request.time,
      hash,
      encryptedVote,
      price: fetchedPrice,
      salt
    };
  }

  async runBatchCommit(requests, roundId) {
    const commitments = [];
    const skipped = [];
    const failures = [];

    for (const request of requests) {
      // Skip commits if a message already exists for this request.
      // This does not check the existence of an actual commit.
      if (await this.getMessage(request, roundId)) {
        skipped.push(request);
        continue;
      }

      try {
        commitments.push(await this.constructCommitment(request, roundId));
      } catch (error) {
        failures.push({ request, error });
      }
    }

    // Always call `batchCommit`, even if there's only one commitment. Difference in gas cost is negligible.
    // TODO (#562): Handle case where tx exceeds gas limit.
    const { receipt } = await this.voting.batchCommit(
      commitments.map(commitment => {
        // This filters out the parts of the commitment that we don't need to send to solidity.
        // Note: this isn't strictly necessary since web3 will only encode variables that share names with properties in
        // the solidity struct.
        const { price, salt, ...rest } = commitment;
        return rest;
      }),
      { from: this.account }
    );

    // Add the batch transaction hash to each commitment.
    commitments.forEach(commitment => {
      commitment.txnHash = receipt.transactionHash;
    });

    return { commitments, skipped, failures };
  }

  async constructReveal(request, roundId) {
    const encryptedCommit = await this.getMessage(request, roundId);

    let vote;

    // Catch messages that are indecipherable and handle by skipping over the request.
    try {
      const { privateKey } = await deriveKeyPairFromSignatureTruffle(web3, getKeyGenMessage(roundId), this.account);
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

    for (const request of requests) {
      const encryptedCommit = await this.getMessage(request, roundId);
      if (!encryptedCommit) {
        continue;
      }

      const reveal = await this.constructReveal(request, roundId);
      if (reveal) {
        reveals.push(reveal);
      }
    }

    // Always call `batchReveal`, even if there's only one reveal.
    // TODO (#562): Handle case where tx exceeds gas limit.
    const { receipt } = await this.voting.batchReveal(reveals, { from: this.account });

    // Add the batch transaction hash to each reveal.
    reveals.forEach(reveal => {
      reveal.txnHash = receipt.transactionHash;
    });

    return reveals;
  }

  constructNotification(updates, skipped, failures, phase) {
    const phaseVerb = phase == VotePhasesEnum.COMMIT ? "committed" : "revealed";

    // Sort the updates by timestamp for the notification.
    updates.sort((a, b) => {
      const aTime = parseInt(a.time);
      const bTime = parseInt(b.time);

      // <0 a before b
      // >0 b before a
      // 0 keep a/b ordering
      return aTime - bTime;
    });

    // Subject tells the user what type of action the AVS took.
    const subject = `AVS Update: price requests ${phaseVerb}` + (failures.length > 0 ? " [ACTION REQUIRED]" : "");

    // Intro is bolded and tells the user how many requests were updated.
    const intro = `<b>The AVS has ${phaseVerb} ${updates.length} price requests, skipped ${skipped.length}, and failed ${failures.length} on-chain.</b>`;

    // Construct information blocks for each request.
    const blocks = updates
      .map((update, i) => {
        const date = new Date(parseInt(update.time) * 10e2);
        return `
      <u>Price request ${i + 1}:</u><br />
      Price feed: ${web3.utils.hexToUtf8(update.identifier)}<br />
      Request time: ${date.toUTCString()} (Unix timestamp: ${date.getTime() / 10e2})<br />
      Value ${phaseVerb}: ${web3.utils.fromWei(update.price)}<br />
      *Salt: ${update.salt}<br />
      **Transaction: ${getTxnLink(update.txnHash)}<br />
      `;
      })
      .concat(
        skipped.map(skipped => {
          const date = new Date(parseInt(skipped.time) * 10e2);
          return `
        <u>Skipped</u><br />
        Price feed: ${web3.utils.hexToUtf8(skipped.identifier)}<br />
        Request time: ${date.toUTCString()} (Unix timestamp: ${date.getTime() / 10e2})<br />
        `;
        })
      )
      .concat(
        failures.map(failure => {
          const date = new Date(parseInt(failure.request.time) * 10e2);
          return `
        <u>ACTION REQUIRED: FAILURE!<u/><br />
        Commit a value for this request manually via the dApp.<br />
        Price feed: ${web3.utils.hexToUtf8(failure.request.identifier)}<br />
        Request time: ${date.toUTCString()} (Unix timestamp: ${date.getTime() / 10e2})<br />
        Error: ${failure.error}<br />
        `;
        })
      );

    // Join the blocks (with a single line break between) to form the text that gives details on all the requests.
    const requestsText = blocks.join(`<br />`);

    // TODO: Add the following docs/links to the bottom of the notification:
    // <bold>Additional information and instructions:</bold>
    // How to manually reveal this vote on-chain: Link*
    // How to manually adjust this vote on-chain: Link
    // How to run this AVS software on your own machine: Link
    // (Optional/later when built (include link): Use the UMA Voter Dapp to adjust or reveal votes)
    // Footer explains particular fields in the request blocks.
    const footer = `
    *If you want to manually reveal your vote, you will need the salt. This should be done rarely, if ever.<br />
    **The AVS attempts to batch commits and reveals to save gas, so it is common to see the same transaction hash for
    multiple commits/reveals.<br />
    `;

    // Concatenate the sections with two line breaks between them.
    const body = `
    ${intro}<br /><br />
    ${requestsText}<br /><br />
    ${footer}
    `;

    return {
      subject,
      body
    };
  }

  async runIteration() {
    console.log("Starting voting iteration");
    const phase = await this.voting.getVotePhase();
    const roundId = await this.voting.getCurrentRoundId();
    const pendingRequests = await this.voting.getPendingRequests();

    let updates = [];
    let skipped = [];
    let failures = [];
    if (phase == VotePhasesEnum.COMMIT) {
      ({ commitments: updates, skipped, failures } = await this.runBatchCommit(pendingRequests, roundId));
      console.log(
        `Completed ${updates.length} commits, skipped ${skipped.length} commits, failed ${failures.length} commits`
      );
    } else {
      updates = await this.runBatchReveal(pendingRequests, roundId);
      console.log(`Completed ${updates.length} reveals`);
    }

    const notification = this.constructNotification(updates, skipped, failures, phase);
    await Promise.all(
      this.notifiers.map(notifier => notifier.sendNotification(notification.subject, notification.body))
    );

    console.log("Finished voting iteration");
  }
}

async function runVoting() {
  try {
    console.log("Running Voting system");
    sendgrid.setApiKey(process.env.SENDGRID_API_KEY);
    const voting = await Voting.deployed();
    const account = (await web3.eth.getAccounts())[0];
    const votingSystem = new VotingSystem(voting, account, getNotifiers());
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
