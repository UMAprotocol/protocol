// collection of functions to compose a automation pipeline with regards to dev/dapp mining.
const assert = require("assert");
const highland = require("highland");
const moment = require("moment");
const Path = require("path");
const fs = require("fs");
const { Octokit } = require("@octokit/rest");

// Hard coded start dates for both dev and dapp mining. These are used to calculate week number given a date.
const devMiningStartTime = moment("2020-11-2 23:00", "YYYY-MM-DD  HH:mm Z").valueOf();
const dappMiningStartTime = moment("2021-01-04 23:00", "YYYY-MM-DD  HH:mm Z").valueOf();

// Turns an address into an etherscan link
function eslink(addr) {
  return `https://etherscan.io/address/${addr}`;
}

// Creates a markdown formatted link for templating markdown files.
function mdlink(text, link) {
  return `[${text}](${link})`;
}

function dappMiningPrTemplate({ issueNumber, config }) {
  const { name, startTime, endTime, rewardFactor, totalRewards, empRewards } = config;
  const startDate = moment(startTime)
    .utc()
    .format("YYYY/MM/DD");
  const endDate = moment(endTime)
    .utc()
    .format("YYYY/MM/DD");
  const title = `improve(affiliates): Dapp Mining rewards for ${name} ${startDate} through ${endDate}`;
  const body = `
**Motivation**
#${issueNumber}

**Details**
Dapp mining for yd-eth-march using .3 of dev mining rewards for this period: \`Math.floor(${empRewards} * ${rewardFactor}) = ${totalRewards}\`

Reproduce with config.json
\`\`\`
${JSON.stringify(config, null, 2)}
\`\`\`

And run with \`node apps/DappMiningRewards.js config.json\`

**Issue(s)**
Fixes #${issueNumber}
`;
  return {
    title,
    body
  };
}

// Generates the title and body for a dev mining PR.
function devMiningPrTemplate({
  issueNumber,
  totalRewards,
  startTime,
  endTime,
  empWhitelist,
  weekNumber,
  fallbackPrices = []
}) {
  console.log({ issueNumber });
  assert(issueNumber, "requires issue number");
  assert(totalRewards, "requires totalRewards");
  assert(endTime, "requires endTime");
  assert(startTime, "requires starTime");
  assert(empWhitelist, "requires empWhiteList");
  assert(weekNumber, "requires weekNumber");
  const startDate = moment(startTime)
    .utc()
    .format("YYYY/MM/DD");
  const endDate = moment(endTime)
    .utc()
    .format("YYYY/MM/DD");
  return {
    title: `improve(affiliates): Dev Mining rewards for week ${weekNumber}`,
    body: `
**Motivation**
#${issueNumber}

**Summary**

Dev Mining results for week ${weekNumber} between ${startDate} (${startTime}) and ${endDate} (${endTime})

**Details**
In order to run create a config.json with this data:
\`\`\`
{
    "startTime": ${startTime},
    "endTime": ${endTime},
    "totalRewards": ${totalRewards},
    "empWhitelist": ${JSON.stringify(empWhitelist)},
    "fallbackPrices": ${JSON.stringify(fallbackPrices)},
}
\`\`\`

Then within the affiliates package run: 
\`cat config.json | node apps/DevMiningRewards --network=mainnet_mnemonic\`


closes #${issueNumber}
`
  };
}

// Generate dapp mining issue body and title
function dappMiningTemplate({ name, empAddress, startTime, endTime, whitelistTable, weekNumber }) {
  const startDate = moment(startTime)
    .utc()
    .format("YYYY/MM/DD");
  const endDate = moment(endTime)
    .utc()
    .format("YYYY/MM/DD");
  const startDateTime = moment(startTime).format("YYYY/MM/DD HH:mm");
  const endDateTime = moment(endTime).format("YYYY/MM/DD HH:mm");
  return {
    title: `Run Dapp Mining rewards for ${name} week ${weekNumber + 1} between ${startDate} and ${endDate}`,
    body: `
Run dapp mining rewards for ${mdlink(name, eslink(empAddress))} week ${weekNumber +
      1} from ${startDateTime} (${startTime}) to ${endDateTime} (${endTime}). 

Name | Tagged Address
-- | -- 
  ${whitelistTable
    .map(data => {
      return data.join(" | ");
    })
    .join("\n")}
`
  };
}

// Generate dev mining issue body and title
function devMiningTemplate({ config, whitelist }) {
  const { startTime, endTime, fallbackPrices, weekNumber } = config;
  const startDate = moment(startTime)
    .utc()
    .format("YYYY/MM/DD");
  const endDate = moment(endTime)
    .utc()
    .format("YYYY/MM/DD");
  const startDateTime = moment(startTime).format("YYYY/MM/DD HH:mm");
  const endDateTime = moment(endTime).format("YYYY/MM/DD HH:mm");
  return {
    title: `Run Dev Mining rewards week ${weekNumber} between ${startDate} and ${endDate}`,
    body: `
Run Dev Mining rewards for week ${weekNumber +
      1} between ${startDateTime} (${startTime}) and ${endDateTime} (${endTime}).

Contract Name | EMP Address | Payout Address
-- | -- | --
  ${whitelist
    .map(data => {
      return [data.name, mdlink(data.empAddress, eslink(data.empAddress)), data.payoutAddress].join(" | ");
    })
    .join("\n")}

If fallback prices are needed it will be shown below:
  ${fallbackPrices
    .map(pair => {
      return "  - " + mdlink(pair[0], eslink(pair[0])) + " = " + "$" + pair[1];
    })
    .join("\n")}
`
  };
}

// Submit issue to github. Requieres auth, which is your github API key.
// Rest = {body, title} which is required for opening an issue.
async function createGithubIssue({ auth, owner = "UMAprotocol", repo = "protocol", ...rest } = {}) {
  assert(auth, "requires github auth credentials");
  const octokit = new Octokit({
    auth
  });
  return octokit.issues.create({
    owner,
    repo,
    ...rest
  });
}

// Takes an array of "details" which is simply an array of objects in this format:
// [{
//   empAddress,
//   payoutAddress,
//   name,
//   identifier,
//   enabled
// }]
// And returns it in the whitelist format consumable by dev mining:
// [
//   [ address, payoutAddress],
//   [ address, payoutAddress],
// ]
function whitelistFromDetails(details) {
  return details.map(detail => {
    return [detail.empAddress, detail.payoutAddress, detail.empVersion];
  });
}
// Fallback prices are the default prices we use for emp synthetics when we dont have a working price feed
// with get historical price periods implemented. We allow this value to be specified from sheets.
function fallbackFromDetails(details) {
  return details
    .filter(detail => {
      return detail.fallbackValue;
    })
    .map(detail => {
      return [detail.empAddress, detail.fallbackValue];
    });
}

// Generates a dev mining config consumable by the dev mining app. It assumes you are passing in various
// parameters here, and will auto generate the week and period if not provided, based on current date.
function generateDevMiningConfig({ whitelist, week, period, totalRewards = 50000 }) {
  const empWhitelist = whitelistFromDetails(whitelist);
  const fallbackPrices = fallbackFromDetails(whitelist);
  week = week || getLastDevMiningWeek();
  period = period || devMiningPeriodByWeek(week);
  return {
    ...period,
    empWhitelist,
    fallbackPrices,
    totalRewards
  };
}

// Generates dapp mining config consumable by dapp mining app. Wil auto generate start,end dates as well
// as week number if week is not provided. Requires empReward number generated from dev mining.
function generateDappMiningConfig(params = {}) {
  let { week, whitelistTable, defaultAddress, empRewards, rewardFactor = 0.3 } = params;
  assert(whitelistTable, "requires whitelist table");
  assert(empRewards, "requires empRewards");
  week = week || getLastDappMiningWeek();
  const period = dappMiningPeriodByWeek(week);
  return {
    ...params,
    ...period,
    defaultAddress,
    totalRewards: Math.floor(parseFloat(empRewards) * rewardFactor),
    whitelist: whitelistTable.map(x => x[1])
  };
}

// For a given week number, calculates the period for rewards, and some metadata for human readability
function miningPeriodByWeek(weekNumber = 0, first) {
  assert(weekNumber >= 0, "requires week number 0 or more");
  assert(first >= 0, "requires start of first payout in ms time");
  const start = moment(first).add(weekNumber, "weeks");
  const end = moment(first).add(weekNumber + 1, "weeks");
  return {
    weekNumber,
    endDate: end.format("L LT"),
    startDate: start.format("L LT"),
    startTime: start.valueOf(),
    endTime: end.valueOf()
  };
}
// This gives you the week the date is in, starting at 0
function getWeekByDate(now, start) {
  assert(now >= start, "current time must be greater than start time of program");
  return Math.floor(moment.duration(now - start).asWeeks());
}
function dappMiningPeriodByWeek(weekNumber = getLastDappMiningWeek(), first = dappMiningStartTime) {
  return miningPeriodByWeek(weekNumber, first);
}
function devMiningPeriodByWeek(weekNumber = getLastDevMiningWeek(), first = devMiningStartTime) {
  return miningPeriodByWeek(weekNumber, first);
}
// gets the current week we are in, which is not complete
function getCurrentDevMiningWeek(date = Date.now(), first = devMiningStartTime) {
  return getWeekByDate(date, first);
}
// gets the current week we are in, which is not complete
function getCurrentDappMiningWeek(date = Date.now(), first = dappMiningStartTime) {
  return getWeekByDate(date, first);
}
// Return the last week of which has a full period.
function getLastDevMiningWeek(date = Date.now(), first = devMiningStartTime) {
  const result = getWeekByDate(date, first);
  assert(result > 0, "Dev mining must experience a full period before getting last week");
  return result - 1;
}
// Returns last week which has a full period.
function getLastDappMiningWeek(date = Date.now(), first = dappMiningStartTime) {
  const result = getWeekByDate(date, first);
  assert(result > 0, "Dev mining must experience a full period before getting last week");
  return result - 1;
}

// Makes a common convention for dev mining files
function makeDevMiningFilename(config) {
  const { startTime, endTime, weekNumber } = config;
  const format = "YYYY-MM-DD";
  const fn = [
    moment(startTime).format(format),
    moment(endTime).format(format),
    weekNumber.toString().padStart(4, "0")
  ].join("_");
  return [fn, "json"].join(".");
}

// Makes a common convention for dapp mining files
function makeDappMiningFilename(config) {
  const { startTime, endTime, name, weekNumber } = config;
  const format = "YYYY-MM-DD";
  const fn = [
    moment(startTime).format(format),
    moment(endTime).format(format),
    name,
    weekNumber.toString().padStart(4, "0")
  ].join("_");
  return [fn, "json"].join(".");
}

// Just saves a js object to file to disk based on a given filename
async function saveToDisk(fn, result) {
  fs.writeFileSync(Path.join(process.cwd(), fn), JSON.stringify(result, null, 2));
  return result;
}

// This provides a convention for passing json data in and out of the app to allow unix piping to work
// with complex data objects. It does this by parsing data from sdtin and constructing a full string
// which is then parsed as a json object. Its then passed into callback which allows abitrary processing.
// The callback can return valid json, which will get stringified and returned. Typically this gets logged to std out.
function makeUnixPipe(cb, stdin = process.stdin) {
  // This is a way to detect if a unix pipe is set up for stdin https://nodejs.org/dist/latest-v6.x/docs/api/process.html#process_a_note_on_process_i_o
  assert(!stdin.isTTY, "This application requires JSON string compatible data to be piped through stdin");
  return (
    highland(stdin)
      // stdin is a stream of chars. This appends all chars into a string, which ends at end of input.
      .reduce("", (result, str) => {
        return result + str;
      })
      // once string is final, we try to parse it as json. We assume that our caller is passing us a valid json string.
      .map(x => JSON.parse(x))
      // once we have the json object we call the callback passing it as a param
      .map(async x => cb(x))
      // we need to do this to extract the result of the promise in the stream.
      .flatMap(highland)
      // we want our result to be also a valid json string, so we can continue chaining the pipeline
      .map(x => {
        try {
          return JSON.stringify(x, null, 2);
        } catch (err) {
          console.error(x);
          throw err;
        }
      })
      // returns string as a promise so we can log it however we need. but typically it would just be std out.
      .toPromise(Promise)
  );
}

module.exports = {
  makeUnixPipe,
  makeDevMiningFilename,
  makeDappMiningFilename,
  dappMiningTemplate,
  devMiningTemplate,
  generateDevMiningConfig,
  miningPeriodByWeek,
  getWeekByDate,
  getCurrentDappMiningWeek,
  getCurrentDevMiningWeek,
  getLastDappMiningWeek,
  getLastDevMiningWeek,
  createGithubIssue,
  dappMiningPeriodByWeek,
  devMiningPeriodByWeek,
  saveToDisk,
  generateDappMiningConfig,
  devMiningPrTemplate,
  dappMiningPrTemplate
};
