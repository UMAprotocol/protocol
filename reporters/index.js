require("dotenv").config();
const { toWei } = web3.utils;

const { delay } = require("../financial-templates-lib/helpers/delay");
const { Logger } = require("../financial-templates-lib/logger/Logger");
const winston = require("winston");

const { createPriceFeed } = require("../financial-templates-lib/price-feed/CreatePriceFeed");
const { Networker } = require("../financial-templates-lib/price-feed/Networker");

// Clients to retrieve on-chain data.
// Clients to retrieve on-chain data.
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyClient");
const { ExpiringMultiPartyEventClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyEventClient");
const { TokenBalanceClient } = require("../financial-templates-lib/clients/TokenBalanceClient");

const { SponsorReporter } = require("./SponsorReporter");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");

async function run(address, walletsToMonitor, priceFeedConfig) {
  console.log(`Starting Reporter Script🖨\n EMP Address: ${address}`);

  // For now we will use a dummy transport to make things quiet in the logs
  const dummyLogger = winston.createLogger({
    level: "error",
    transports: [new winston.transports.Console()]
  });

  const emp = await ExpiringMultiParty.at(address);
  const empClient = new ExpiringMultiPartyClient(dummyLogger, ExpiringMultiParty.abi, web3, emp.address, 10);

  const getTime = () => Math.round(new Date().getTime() / 1000);
  const priceFeed = await createPriceFeed(dummyLogger, web3, new Networker(dummyLogger), getTime, priceFeedConfig);
  const sponsorReporter = new SponsorReporter(empClient, walletsToMonitor, priceFeed);

  await sponsorReporter.getMonitoredWalletMetrics();
}

const Poll = async function(callback) {
  try {
    if (!process.env.EMP_ADDRESS || !process.env.WALLET_MONITOR_OBJECT || !process.env.PRICE_FEED_CONFIG) {
      throw "Bad setup! Must specify EMP_ADDRESS, WALLET_MONITOR_OBJECT and PRICE_FEED_CONFIG";
    }

    const empAddress = process.env.EMP_ADDRESS;

    const walletsToMonitor = JSON.parse(process.env.WALLET_MONITOR_OBJECT);

    const priceFeedConfig = JSON.parse(process.env.PRICE_FEED_CONFIG);

    await run(empAddress, walletsToMonitor, priceFeedConfig);
    callback();
  } catch (err) {
    callback(err);
  }
};

Poll.run = run;
// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
