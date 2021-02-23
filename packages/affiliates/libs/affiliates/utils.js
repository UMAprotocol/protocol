// collection of functions to compose a automation pipeline
const assert = require("assert");
const highland = require("highland");
const moment = require("moment");
const Path = require("path");
const fs = require("fs");
const { Octokit } = require("@octokit/rest");

const devMiningStartTime = moment("2020-11-2 23:00", "YYYY-MM-DD  HH:mm Z").valueOf();
const dappMiningStartTime = moment("2021-01-04 23:00", "YYYY-MM-DD  HH:mm Z").valueOf();

function eslink(addr) {
  return `https://etherscan.io/address/${addr}`;
}

function mdlink(text, link) {
  return `[${text}](${link})`;
}

function devMiningPrTemplate({
  issueNumber,
  totalRewards,
  startTime,
  endTime,
  empWhiteList,
  weekNumber,
  fallbackPrices = []
}) {
  assert(issueNumber, "requires issue number");
  assert(totalRewards, "requires totalRewards");
  assert(endTime, "requires endTime");
  assert(startTime, "requires starTime");
  assert(empWhiteList, "requires empWhiteList");
  assert(weekNumber, "requires weekNumber");
  const startDate = moment(startTime)
    .utc()
    .format("YYYY/MM/DD");
  const endDate = moment(endTime)
    .utc()
    .format("YYYY/MM/DD");
  return {
    title: `Run Dev Mining rewards for week ${weekNumber + 1} between ${startDate} and ${endDate}`,
    body: `
**Motivation**
#${issueNumber}

**Summary**

Dev Mining results for week ${weekNumber}

**Details**
In order to run create a config.json with this data:
\`\`\`
{
    "startTime": ${startTime},
    "endTime": ${endTime},
    "totalRewards": ${totalRewards},
    "empWhitelist": ${empWhiteList},
    "fallbackPrices": ${fallbackPrices},
}
\`\`\`

then run 
\`node app \`


closes #${issueNumber}
`
  };
}

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
    title: `Run Dev Mining rewards between ${startDate} and ${endDate}`,
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

function whitelistFromDetails(details) {
  return details.map(detail => {
    return [detail.empAddress, detail.payoutAddress];
  });
}
function generateDevMiningConfig({ whitelist, week, period, totalRewards = 50000 }) {
  const empWhitelist = whitelistFromDetails(whitelist);
  const fallbackPrices = [];
  week = week || getLastDevMiningWeek();
  period = period || devMiningPeriodByWeek(week);
  return {
    ...period,
    empWhitelist,
    fallbackPrices,
    totalRewards
  };
}

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

async function saveToDisk(fn, result) {
  fs.writeFileSync(Path.join(process.cwd(), fn), JSON.stringify(result, null, 2));
  return result;
}

function makeUnixPipe(through, stdin = process.stdin) {
  return highland(stdin)
    .reduce("", (result, str) => {
      return result + str;
    })
    .map(x => JSON.parse(x))
    .map(async x => through(x))
    .flatMap(highland)
    .map(x => JSON.stringify(x, null, 2))
    .toPromise(Promise);
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
  devMiningPrTemplate
};
