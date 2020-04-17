const Voting = artifacts.require("Voting");
const { VotePhasesEnum } = require("../../common/Enums");
const { BATCH_MAX_COMMITS, BATCH_MAX_REVEALS } = require("../../common/Constants");
const { computeTopicHash } = require("../../common/EncryptionHelper");
const publicNetworks = require("../../common/PublicNetworks");
const sendgrid = require("@sendgrid/mail");
const fetch = require("node-fetch");
require("dotenv").config();
const gmailSend = require("gmail-send")();
const moment = require("moment");
const {
  constructCommitment: _constructCommitment,
  constructReveal: _constructReveal,
  batchRevealVotes,
  batchCommitVotes,
  getLatestEvent
} = require("../../common/VotingUtils");

const argv = require("minimist")(process.argv.slice(), { string: ["network"] });

const SUPPORTED_IDENTIFIERS = {
  "BTC/USD": {
    numerator: {
      dataSource: "Manual"
    }
  },
  "ETH/USD": {
    numerator: {
      dataSource: "Manual"
    }
  },
  "CMC Total Market Cap": {
    numerator: {
      dataSource: "Manual"
    },
    denominator: {
      dataSource: "Constant",
      value: "1000000000"
    }
  },
  "S&P 500": {
    numerator: {
      dataSource: "IntrinioEquities",
      symbol: "SPY",
      source: "bats"
    },
    denominator: {
      dataSource: "Constant",
      value: "0.1"
    }
  },
  TSLA: {
    numerator: {
      dataSource: "IntrinioEquities",
      symbol: "TSLA",
      source: "bats"
    }
  },
  "Gold (Rolling Future)": {
    numerator: {
      dataSource: "IntrinioEquities",
      symbol: "GLD",
      source: "bats"
    },
    denominator: {
      dataSource: "Constant",
      value: "0.1"
    }
  },
  "Crude Oil (Rolling Future)": {
    numerator: {
      dataSource: "IntrinioEquities",
      symbol: "USO",
      source: "bats"
    },
    denominator: {
      dataSource: "Constant",
      value: "0.1"
    }
  },
  "CNY/USD": {
    numerator: {
      dataSource: "Constant",
      value: "1"
    },
    denominator: {
      dataSource: "IntrinioForex",
      // Intrinio doesn't provide a CNHUSD quote, so we take the reciprocal of the USDCNH quote.
      symbol: "USDCNH"
    }
  },
  "Telegram SAFT": {
    numerator: {
      dataSource: "Constant",
      value: "100"
    }
  },
  "USD/ETH": {
    numerator: {
      dataSource: "Manual"
    }
  },
  "Custom Index (1)": {
    numerator: {
      dataSource: "Constant",
      value: "1"
    }
  },
  "Custom Index (100)": {
    numerator: {
      dataSource: "Constant",
      value: "100"
    }
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

async function fetchCryptoComparePrice(request, isProd) {
  const identifier = request.identifier;
  const time = request.time;

  // Temporary price feed until we sort historical data.
  // CryptoCompare provides historical hourly prices for free. If we want minutes/seconds, we'll have to update later.
  const url = [
    "https://min-api.cryptocompare.com/data/histohour?",
    "fsym=" + identifier.first,
    "&tsym=" + identifier.second,
    "&toTs=" + time,
    "&limit=1",
    "&api_key=" + CC_API_KEY
  ].join("");
  if (isProd) {
    console.log(`\n    ***** \n Querying with [${stripApiKey(url, CC_API_KEY)}]\n    ****** \n`);
  }
  const jsonOutput = await getJson(url);
  if (isProd) {
    console.log(`Response [${JSON.stringify(jsonOutput)}]`);
  }

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
  if (isProd) {
    console.log(`Retrieved quote [${price}] at [${tradeTime}] for asset [${identifier.first}${identifier.second}]`);
  }

  return web3.utils.toWei(price.toString());
}

function fetchConstantPrice(request, config, isProd) {
  if (isProd) {
    console.log(
      `Returning constant price [${config.value}] at [${request.time}] for asset [${web3.utils.hexToUtf8(
        request.identifier
      )}]`
    );
  }
  return web3.utils.toWei(config.value);
}

function getIntrinioTimeArguments(time) {
  const requestMoment = moment.unix(time);
  const requestDate = requestMoment.utc().format("YYYY-MM-DD");
  const requestTime = requestMoment.utc().format("HH:mm:ss");

  // If we don't specify a `start_time` or `start_date`, Intrinio APIs return data in reverse chronological order, up to
  // `end_time`.
  return ["&end_date=" + requestDate, "&end_time=" + requestTime];
}

async function fetchIntrinioEquitiesPrice(request, config, isProd) {
  const url = [
    "https://api-v2.intrinio.com/securities/",
    config.symbol,
    "/prices/intraday?",
    "api_key=" + process.env.INTRINIO_API_KEY,
    "&source=" + config.source,
    "&page_size=1"
  ]
    .concat(getIntrinioTimeArguments(request.time))
    .join("");

  if (isProd) {
    console.log(`\n    ***** \n Querying with [${stripApiKey(url, process.env.INTRINIO_API_KEY)}]\n    ****** \n`);
  }
  const jsonOutput = await getJson(url);
  if (isProd) {
    console.log("Intrinio response:", jsonOutput);
  }

  if (!jsonOutput.intraday_prices || jsonOutput.intraday_prices.length === 0) {
    throw "Failed to get data from Intrinio";
  }

  const price = jsonOutput.intraday_prices[0].last_price;
  const time = jsonOutput.intraday_prices[0].time;
  if (isProd) {
    console.log(`Retrieved quote [${price}] at [${time}] for asset [${web3.utils.hexToUtf8(request.identifier)}]`);
  }
  return web3.utils.toWei(price.toString());
}

async function fetchIntrinioForexPrice(request, config, isProd) {
  const url = [
    "https://api-v2.intrinio.com/forex/prices/",
    config.symbol,
    "/m1?",
    "api_key=" + process.env.INTRINIO_API_KEY,
    "&timezone=UTC",
    "&page_size=1"
  ]
    .concat(getIntrinioTimeArguments(request.time))
    .join("");
  if (isProd) {
    console.log(`\n    ***** \n Querying with [${stripApiKey(url, process.env.INTRINIO_API_KEY)}]\n    ****** \n`);
  }
  const jsonOutput = await getJson(url);
  if (isProd) {
    console.log("Intrinio response:", jsonOutput);
  }

  if (!jsonOutput.prices || jsonOutput.prices.length === 0) {
    throw "Failed to get data from Intrinio";
  }

  // TODO(ptare): Forex quotes don't appear to have trade prices!?
  const price = jsonOutput.prices[0].open_bid;
  const time = jsonOutput.prices[0].occurred_at;
  if (isProd) {
    console.log(`Retrieved quote [${price}] at [${time}] for asset [${web3.utils.hexToUtf8(request.identifier)}]`);
  }
  return web3.utils.toWei(price.toString());
}

async function fetchIntrinioCryptoPrice(request, config, isProd) {
  const url = [
    "https://api-v2.intrinio.com/crypto/prices?",
    "api_key=" + process.env.INTRINIO_API_KEY,
    "&currency=" + config.symbol,
    "&page_size=1",
    "&timeframe=m1"
  ]
    .concat(getIntrinioTimeArguments(request.time))
    .join("");
  if (isProd) {
    console.log(`\n    ***** \n Querying with [${stripApiKey(url, process.env.INTRINIO_API_KEY)}]\n    ****** \n`);
  }
  const jsonOutput = await getJson(url);
  if (isProd) {
    console.log("Intrinio response:", jsonOutput);
  }

  if (!jsonOutput.prices || jsonOutput.prices.length === 0) {
    throw "Failed to get data from Intrinio";
  }

  const price = jsonOutput.prices[0].open;
  const time = jsonOutput.prices[0].time;
  if (isProd) {
    console.log(`Retrieved quote [${price}] at [${time}] for asset [${web3.utils.hexToUtf8(request.identifier)}]`);
  }
  return web3.utils.toWei(price.toString());
}

// Works for equities and futures (even though it uses the _EQUITIES_API_KEY).
async function fetchBarchartPrice(request, config, isProd) {
  // NOTE: this API only provides data up to a month in the past and only to minute granularities. If the requested
  // `time` has a nonzero number of seconds (not a round minute) or is longer than 1 month in the past, this call will
  // fail.
  // The `endDate` param appears to have no effect on the result so we don't pass it.
  const startDate = moment.unix(request.time).format("YYYYMMDD");
  const key = process.env.BARCHART_EQUITIES_API_KEY;
  const url = [
    "https://marketdata.websol.barchart.com/getHistory.json?",
    "key=" + key,
    "&symbol=" + config.symbol,
    "&type=minutes",
    "&startDate=" + startDate
  ].join("");
  if (isProd) {
    console.log(`\n    ***** \n Querying with [${stripApiKey(url, key)}]\n    ****** \n`);
  }

  const jsonOutput = await getJson(url);

  if (jsonOutput.status.code != 200) {
    if (isProd) {
      console.log("Barchart response:", jsonOutput);
    }
    throw "Barchart request failed";
  }

  // The logic below looks for an _exact_ match between the request's timestamp and the returned data's timestamp.
  // This approach is the safest, i.e., will not push an incorrect price.
  const millis = request.time * 1000;
  for (const result of jsonOutput.results) {
    const timestamp = Date.parse(result.timestamp);
    if (millis === timestamp) {
      return web3.utils.toWei(result.open.toString());
    }
  }

  throw "Failed to get a matching timestamp";
}

async function fetchPriceInner(request, config, isProd) {
  switch (config.dataSource) {
    case "CryptoCompare":
      return await fetchCryptoComparePrice(
        {
          identifier: { first: config.identifiers.first, second: config.identifiers.second },
          time: request.time
        },
        isProd
      );
    case "Constant":
      return await fetchConstantPrice(request, config, isProd);
    case "IntrinioEquities":
      return await fetchIntrinioEquitiesPrice(request, config, isProd);
    case "IntrinioForex":
      return await fetchIntrinioForexPrice(request, config, isProd);
    case "Barchart":
      return await fetchBarchartPrice(request, config, isProd);
    case "Manual":
      throw "Unsupported config. Please vote manually using the dApp";
    default:
      throw "No known data source specified";
  }
}

async function fetchPrice(request, isProd) {
  const plainTextIdentifier = web3.utils.hexToUtf8(request.identifier);
  if (plainTextIdentifier.startsWith("test")) {
    return web3.utils.toWei("1.5");
  }
  const config = SUPPORTED_IDENTIFIERS[plainTextIdentifier];
  const numerator = await fetchPriceInner(request, config.numerator, isProd);
  if (config.denominator) {
    const denominator = await fetchPriceInner(request, config.denominator, isProd);
    return web3.utils
      .toBN(numerator)
      .mul(web3.utils.toBN(web3.utils.toWei("1")))
      .div(web3.utils.toBN(denominator))
      .toString();
  } else {
    return numerator;
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
  async sendNotification(subject, body, isProd) {
    if (isProd) {
      console.log(`Notification subject: ${subject}`);
      console.log(`Notification body: ${body}`);
    }
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
    this.maxBatchCommits = BATCH_MAX_COMMITS;
    this.maxBatchReveals = BATCH_MAX_REVEALS;
  }

  async hasCommit(request, roundId) {
    const ev = await getLatestEvent("EncryptedVote", request, roundId, this.account, this.voting);
    return ev == null ? false : true;
  }

  async getCommit(request, roundId) {
    const ev = await getLatestEvent("EncryptedVote", request, roundId, this.account, this.voting);
    return ev == null ? null : ev.encryptedVote;
  }

  async hasReveal(request, roundId) {
    const ev = await getLatestEvent("VoteRevealed", request, roundId, this.account, this.voting);
    return ev == null ? false : true;
  }

  async constructCommitment(request, roundId, isProd) {
    const fetchedPrice = await fetchPrice(request, isProd);
    return await _constructCommitment(request, roundId, web3, web3.utils.fromWei(fetchedPrice), this.account);
  }

  async runBatchCommit(requests, roundId, isProd) {
    let commitments = [];
    const skipped = [];
    const failures = [];
    let batches = 0;

    // Batch requests up to the max number that we can fit into one block
    let requestsProcessed = 0;
    while (requestsProcessed < requests.length) {
      // Construct a new batch
      const newCommitments = [];
      for (let i = commitments.length; i < requests.length; i++) {
        let request = requests[i];

        // Stop processing requests if new batch transaction limit is reached
        if (newCommitments.length == this.maxBatchCommits) {
          break;
        }

        requestsProcessed += 1;

        // Skip commits if a message already exists for this request.
        // This does not check the existence of an actual commit.
        if (await this.hasCommit(request, roundId)) {
          skipped.push(request);
          continue;
        }

        try {
          newCommitments.push(await this.constructCommitment(request, roundId, isProd));
        } catch (error) {
          console.error("Failed to construct commitment", error);
          failures.push({ request, error });
        }
      }

      if (newCommitments.length > 0) {
        const { successes, batches: _batches } = await batchCommitVotes(newCommitments, this.voting, this.account);
        commitments = commitments.concat(successes);
        batches += _batches;
      }
    }

    // Return receipt for testing purposes
    return { commitments, skipped, failures, batches };
  }

  async constructReveal(request, roundId, isProd) {
    try {
      return await _constructReveal(request, roundId, web3, this.account, this.voting);
    } catch (e) {
      if (isProd) {
        console.error("Failed to decrypt message:", e);
      }
      return null;
    }
  }

  async runBatchReveal(requests, roundId, isProd) {
    let reveals = [];
    let batches = 0;

    // Batch requests up to the max number that we can fit into one block
    let requestsProcessed = 0;
    while (requestsProcessed < requests.length) {
      // Construct a new batch
      const newReveals = [];
      for (let i = reveals.length; i < requests.length; i++) {
        let request = requests[i];

        // Stop processing requests if the batch transaction limit is reached
        if (newReveals.length == this.maxBatchReveals) {
          break;
        }

        requestsProcessed += 1;

        const encryptedCommit = await this.getCommit(request, roundId);
        const hasRevealed = await this.hasReveal(request, roundId);
        if (!encryptedCommit || hasRevealed) {
          continue;
        }

        const reveal = await this.constructReveal(request, roundId, isProd);
        if (reveal) {
          newReveals.push(reveal);
        }
      }

      // Append any of new batch's reveals to running reveals list
      if (newReveals.length > 0) {
        const { successes, batches: _batches } = await batchRevealVotes(newReveals, this.voting, this.account);
        reveals = reveals.concat(successes);
        batches += _batches;
      }
    }

    // Return receipt for testing purposes
    return { reveals, batches };
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
    const requestsText = blocks.join("<br />");

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

  constructErrorNotification(error) {
    const subject = "Fatal error running AVS [ACTION REQUIRED]";
    const body = "AVS failed with the following error:<br />" + error;
    return { subject, body };
  }

  async innerRunIteration(isProd) {
    const phase = await this.voting.getVotePhase();
    const roundId = await this.voting.getCurrentRoundId();
    const pendingRequests = await this.voting.getPendingRequests();

    let updates = [];
    let skipped = [];
    let failures = [];
    let batches = 0;
    if (phase == VotePhasesEnum.COMMIT) {
      ({ commitments: updates, skipped, failures, batches } = await this.runBatchCommit(
        pendingRequests,
        roundId,
        isProd
      ));
      if (isProd) {
        console.log(
          `Completed ${updates.length} commits, skipped ${skipped.length} commits, failed ${
            failures.length
          } commits, split into ${batches} batch${batches != 1 ? "es" : ""}`
        );
      }
    } else {
      ({ reveals: updates, batches } = await this.runBatchReveal(pendingRequests, roundId, isProd));
      if (isProd) {
        console.log(`Completed ${updates.length} reveals, split into ${batches} batch${batches != 1 ? "es" : ""}`);
      }
    }

    const notification = this.constructNotification(updates, skipped, failures, phase);
    await Promise.all(
      this.notifiers.map(notifier => notifier.sendNotification(notification.subject, notification.body, isProd))
    );

    return { updates, skipped, failures, batches };
  }

  async runIteration(isProd) {
    if (isProd) {
      console.log("Starting voting iteration");
    }

    let results;
    try {
      results = await this.innerRunIteration(isProd);
    } catch (error) {
      // A catch-all error handler, so the user gets notified if the AVS crashes. Note that errors fetching prices for
      // some feeds is not considered a crash, and the user will be sent a more detailed message in that case.
      const notification = this.constructErrorNotification(error);
      await Promise.all(
        this.notifiers.map(notifier => notifier.sendNotification(notification.subject, notification.body, isProd))
      );
    }

    if (isProd) {
      console.log("Finished voting iteration");
    }
    return results;
  }
}

async function runVoting(isProd) {
  try {
    if (isProd) {
      console.log("Running Voting system");
    }
    sendgrid.setApiKey(process.env.SENDGRID_API_KEY);
    const voting = await Voting.deployed();
    const account = (await web3.eth.getAccounts())[0];
    const votingSystem = new VotingSystem(voting, account, getNotifiers());
    return await votingSystem.runIteration(isProd);
  } catch (error) {
    console.error("AVS Failed:", error);
  }
}

run = async function(callback) {
  // For production script, unnecessary to return stats on successful, skipped, failed requests or batch data
  await runVoting({ isProd: true });
  callback();
};

run.VotingSystem = VotingSystem;
run.SUPPORTED_IDENTIFIERS = SUPPORTED_IDENTIFIERS;
module.exports = run;
