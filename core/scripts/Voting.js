const Voting = artifacts.require("Voting");
const { VotePhasesEnum } = require("../../common/Enums");
const { decryptMessage, encryptMessage, deriveKeyPairFromSignatureTruffle } = require("../../common/Crypto");
const { computeTopicHash, getKeyGenMessage } = require("../../common/EncryptionHelper");
const publicNetworks = require("../../common/PublicNetworks");
const sendgrid = require("@sendgrid/mail");
const fetch = require("node-fetch");
require("dotenv").config();
const gmailSend = require("gmail-send")();
const moment = require("moment");

const argv = require("minimist")(process.argv.slice(), { string: ["network"] });

const SUPPORTED_IDENTIFIERS = {
  BTCUSD: {
    numerator: {
      dataSource: "CryptoCompare",
      identifiers: { first: "BTC", second: "USD" }
    }
  },
  "BTC/USD": {
    numerator: {
      dataSource: "IntrinioCrypto",
      symbol: "btcusd"
    }
  },
  "ETH/USD": {
    numerator: {
      dataSource: "IntrinioCrypto",
      symbol: "ethusd"
    }
  },
  "CMC Total Market Cap": {
    numerator: {
      dataSource: "CMC",
      symbol: "total_market_cap"
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
      dataSource: "Barchart",
      symbol: "GC*1"
    }
  },
  "Crude Oil (Rolling Future)": {
    numerator: {
      dataSource: "IntrinioEquities",
      symbol: "OIL",
      source: "iex"
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
      dataSource: "Constant",
      value: "1"
    },
    denominator: {
      dataSource: "IntrinioCrypto",
      symbol: "ethusd"
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

async function fetchCryptoComparePrice(request) {
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
  console.log(`\n    ***** \n Querying with [${stripApiKey(url, CC_API_KEY)}]\n    ****** \n`);
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

function fetchConstantPrice(request, config) {
  console.log(
    `Returning constant price [${config.value}] at [${request.time}] for asset [${web3.utils.hexToUtf8(
      request.identifier
    )}]`
  );
  return web3.utils.toWei(config.value);
}

function getIntrinioTimeArguments(time) {
  const requestMoment = moment.unix(time);
  const startDate = requestMoment.format("YYYY-MM-DD");
  const startTime = requestMoment.format("HH:mm:ss");

  // How to determine this time window? Picked 10000 seconds arbitrarily.
  const timeWindowSeconds = 10000;
  const endMoment = moment.unix(Number(time) + timeWindowSeconds);
  const endDate = endMoment.format("YYYY-MM-DD");
  const endTime = endMoment.format("HH:mm:ss");

  return ["&start_date=" + startDate, "&start_time=" + startTime, "&end_date=" + endDate, "&end_time=" + endTime];
}

async function fetchIntrinioEquitiesPrice(request, config) {
  const url = [
    "https://api-v2.intrinio.com/securities/",
    config.symbol,
    "/prices/intraday?",
    "api_key=" + process.env.INTRINIO_API_KEY,
    "&source=" + config.source
  ]
    .concat(getIntrinioTimeArguments(request.time))
    .join("");
  console.log(`\n    ***** \n Querying with [${stripApiKey(url, process.env.INTRINIO_API_KEY)}]\n    ****** \n`);
  const jsonOutput = await getJson(url);

  if (!jsonOutput.intraday_prices || jsonOutput.intraday_prices.length === 0) {
    // The JSON output can be large when it succeeds, so we only print it in cases of failure.
    console.log("Intrinio response:", jsonOutput);
    throw "Failed to get data from Intrinio";
  }

  const price = jsonOutput.intraday_prices[0].last_price;
  const time = jsonOutput.intraday_prices[0].time;
  console.log(`Retrieved quote [${price}] at [${time}] for asset [${web3.utils.hexToUtf8(request.identifier)}]`);
  return web3.utils.toWei(price.toString());
}

async function fetchIntrinioForexPrice(request, config) {
  const url = [
    "https://api-v2.intrinio.com/forex/prices/",
    config.symbol,
    "/m1?",
    "api_key=" + process.env.INTRINIO_API_KEY
  ]
    .concat(getIntrinioTimeArguments(request.time))
    .join("");
  console.log(`\n    ***** \n Querying with [${stripApiKey(url, process.env.INTRINIO_API_KEY)}]\n    ****** \n`);
  const jsonOutput = await getJson(url);

  if (!jsonOutput.prices || jsonOutput.prices.length === 0) {
    // The JSON output can be large when it succeeds, so we only print it in cases of failure.
    console.log("Intrinio response:", jsonOutput);
    throw "Failed to get data from Intrinio";
  }

  // No prices!?
  const price = jsonOutput.prices[0].open_bid;
  const time = jsonOutput.prices[0].occurred_at;
  console.log(`Retrieved quote [${price}] at [${time}] for asset [${web3.utils.hexToUtf8(request.identifier)}]`);
  return web3.utils.toWei(price.toString());
}

async function fetchIntrinioCryptoPrice(request, config) {
  const url = [
    "https://api-v2.intrinio.com/crypto/prices?",
    "api_key=" + process.env.INTRINIO_API_KEY,
    "&currency=" + config.symbol,
    "&timeframe=m1"
  ]
    .concat(getIntrinioTimeArguments(request.time))
    .join("");
  console.log(`\n    ***** \n Querying with [${stripApiKey(url, process.env.INTRINIO_API_KEY)}]\n    ****** \n`);
  const jsonOutput = await getJson(url);

  if (!jsonOutput.prices || jsonOutput.prices.length === 0) {
    // The JSON output can be large when it succeeds, so we only print it in cases of failure.
    console.log("Intrinio response:", jsonOutput);
    throw "Failed to get data from Intrinio";
  }

  const price = jsonOutput.prices[0].open;
  const time = jsonOutput.prices[0].time;
  console.log(`Retrieved quote [${price}] at [${time}] for asset [${web3.utils.hexToUtf8(request.identifier)}]`);
  return web3.utils.toWei(price.toString());
}

async function fetchCmcPrice(request, config) {
  const url = [
    "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/historical?",
    "CMC_PRO_API_KEY=" + process.env.CMC_PRO_API_KEY,
    "&symbol=" + config.symbol,
    "&time_start=" + request.time,
    "&time_end=" + (Number(request.time) + 1000)
  ].join("");
  console.log(`\n    ***** \n Querying with [${stripApiKey(url, process.env.CMC_PRO_API_KEY)}]\n    ****** \n`);
  const jsonOutput = await getJson(url);

  if (!jsonOutput.data || !jsonOutput.data.quotes || jsonOutput.data.quotes.length === 0) {
    // The JSON output can be large when it succeeds, so we only print it in cases of failure.
    console.log("CMC response:", jsonOutput);
    throw "Failed to get data from CMC";
  }

  const price = jsonOutput.data.quotes[0].quote.USD.price;
  const time = jsonOutput.data.quotes[0].quote.USD.timestamp;
  console.log(`Retrieved quote [${price}] at [${time}] for asset [${web3.utils.hexToUtf8(request.identifier)}]`);
  return web3.utils.toWei(price.toString());
}

// Works for equities and futures (even though it uses the _EQUITIES_API_KEY).
async function fetchBarchartPrice(request, config) {
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
  console.log(`\n    ***** \n Querying with [${stripApiKey(url, key)}]\n    ****** \n`);

  const jsonOutput = await getJson(url);

  if (jsonOutput.status.code != 200) {
    console.log("Barchart response:", jsonOutput);
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

async function fetchPriceInner(request, config) {
  switch (config.dataSource) {
    case "CryptoCompare":
      return await fetchCryptoComparePrice({
        identifier: { first: config.identifiers.first, second: config.identifiers.second },
        time: request.time
      });
    case "Constant":
      return await fetchConstantPrice(request, config);
    case "IntrinioEquities":
      return await fetchIntrinioEquitiesPrice(request, config);
    case "IntrinioCrypto":
      return await fetchIntrinioCryptoPrice(request, config);
    case "IntrinioForex":
      return await fetchIntrinioForexPrice(request, config);
    case "CMC":
      return await fetchCmcPrice(request, config);
    case "Barchart":
      return await fetchBarchartPrice(request, config);
    default:
      throw "No known data source specified";
  }
}

async function fetchPrice(request) {
  const plainTextIdentifier = web3.utils.hexToUtf8(request.identifier);
  if (plainTextIdentifier.startsWith("test")) {
    return web3.utils.toWei("1.5");
  }
  const config = SUPPORTED_IDENTIFIERS[plainTextIdentifier];
  const numerator = await fetchPriceInner(request, config.numerator);
  if (config.denominator) {
    const denominator = await fetchPriceInner(request, config.denominator);
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
    // throw new Error("User did not pass any valid email credentials");
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
        console.log("Failed", error);
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

  constructErrorNotification(error) {
    const subject = "Fatal error running AVS [ACTION REQUIRED]";
    const body = "AVS failed with the following error:<br />" + error;
    return { subject, body };
  }

  async innerRunIteration() {
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
  }

  async runIteration() {
    console.log("Starting voting iteration");
    try {
      await this.innerRunIteration();
    } catch (error) {
      // A catch-all error handler, so the user gets notified if the AVS crashes. Note that errors fetching prices for
      // some feeds is not considered a crash, and the user will be sent a more detailed message in that case.
      const notification = this.constructErrorNotification(error);
      await Promise.all(
        this.notifiers.map(notifier => notifier.sendNotification(notification.subject, notification.body))
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
run.SUPPORTED_IDENTIFIERS = SUPPORTED_IDENTIFIERS;
module.exports = run;
