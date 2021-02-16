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

function dappMiningTemplate({ contractName, contractAddress, startTime, endTime, whitelist, weekNumber }) {
  const startDate = moment(startTime)
    .utc()
    .format("YYYY/MM/DD");
  const endDate = moment(endTime)
    .utc()
    .format("YYYY/MM/DD");
  const startDateTime = moment(startTime).format("YYYY/MM/DD HH:mm");
  const endDateTime = moment(endTime).format("YYYY/MM/DD HH:mm");
  return {
    title: `Run Dapp Mining rewards for ${contractName} week ${weekNumber + 1} between ${startDate} and ${endDate}`,
    body: `
Run dapp mining rewards for ${mdlink(contractName, eslink(contractAddress))} week ${weekNumber +
      1} from ${startDateTime} (${startTime}) to ${endDateTime} (${endTime}).

Use whitelisted addresses:
  ${whitelist
    .map(addr => {
      return `  - ${mdlink(addr, eslink(addr))}`;
    })
    .join("\n")}
`
  };
}

function devMiningTemplate({ startTime, endTime, fallbackPrices, details, weekNumber }) {
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
  ${details
    .map(data => {
      return [data.name, mdlink(data.empAddress, eslink(data.empAddress)), data.payoutAddress].join(" | ");
    })
    .join("\n")}

We will be forcing several contracts to a default price due to lack of consistent price feeds:
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
    auth: process.env.github
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
function generateConfig(details) {
  const startTime = moment("2021-02-01 23:00", "YYYY-MM-DD  HH:mm Z").valueOf();
  const endTime = moment(startTime)
    .add(7, "days")
    .valueOf();
  const empWhitelist = whitelistFromDetails(details);
  const fallbackPrices = [
    ["0xeAddB6AD65dcA45aC3bB32f88324897270DA0387", "1"],
    ["0xf215778f3a5e7ab6a832e71d87267dd9a9ab0037", "1"],
    ["0x267D46e71764ABaa5a0dD45260f95D9c8d5b8195", "1"],
    ["0x2862a798b3defc1c24b9c0d241beaf044c45e585", "1"],
    ["0xd81028a6fbaaaf604316f330b20d24bfbfd14478", "1"]
  ];
  const totalRewards = "50000";
  const network = 1;
  return {
    startTime,
    endTime,
    empWhitelist,
    fallbackPrices,
    totalRewards,
    network
  };
}
function generateMarkdownConfig(details) {
  return {
    details,
    ...generateConfig(details)
  };
}

function miningPeriodByWeek(weekNumber = 0, first) {
  return {
    weekNumber,
    startTime: moment(first)
      .add(weekNumber, "weeks")
      .valueOf(),
    endTime: moment(first)
      .add(weekNumber + 1, "weeks")
      .valueOf()
  };
}
function getWeekByDate(now, start) {
  assert(now >= start, "current time must be greater than start time of program");
  return Math.floor(moment.duration(now - start).asWeeks());
}
function dappMiningPeriodByWeek(weekNumber, first = dappMiningStartTime) {
  return miningPeriodByWeek(weekNumber, first);
}
function devMiningPeriodByWeek(weekNumber = 0, first = devMiningStartTime) {
  return miningPeriodByWeek(weekNumber, first);
}
// returns the current week you are in, not the last week which has a full period. This means you most likely
// want to subtract the result by 1, to get the last week which has a full period.
function getDevMiningWeek(date = Date.now(), first = devMiningStartTime) {
  return getWeekByDate(date, first);
}
// returns the current week you are in, not the last week which has a full period. This means you most likely
// want to subtract the result by 1, to get the last week which has a full period.
function getDappMiningWeek(date = Date.now(), first = dappMiningStartTime) {
  return getWeekByDate(date, first);
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
    .through(through)
    .map(x => JSON.stringify(x, null, 2))
    .toPromise(Promise);
}

module.exports = {
  makeUnixPipe,
  makeDevMiningFilename,
  makeDappMiningFilename,
  dappMiningTemplate,
  devMiningTemplate,
  generateMarkdownConfig,
  generateConfig,
  miningPeriodByWeek,
  getWeekByDate,
  getDappMiningWeek,
  getDevMiningWeek,
  createGithubIssue,
  dappMiningPeriodByWeek,
  devMiningPeriodByWeek,
  saveToDisk
};
