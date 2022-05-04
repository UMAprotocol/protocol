#!/usr/bin/env node

// To run the script, include the MNEMONIC and CUSTOM_NODE_URL variables in a .env file. Run the following command (from repo root):
// HARDHAT_NETWORK=kovan node ./packages/scripts/src/demo/lsp-demo/lsp-deploy.js

// Helper modules
const { web3 } = require("hardhat");
const { utf8ToHex, padRight, toWei } = web3.utils;
const { getAbi, getAddress } = require("@uma/contracts-node");
const fs = require("fs");
const path = require("path");

// Constants
const chainId = 42;
const startTimestamp = Math.floor(Date.now() / 1000);

// Mandatory LSP Params
const expirationTimestamp = (startTimestamp + 600).toString(); // Set contract to expire 600 seconds after deployment
const priceIdentifier = padRight(utf8ToHex("YES_OR_NO_QUERY"), 64);
const collateralPerPair = toWei("1");
const collateralToken = "0x489Bf230d4Ab5c2083556E394a28276C22c3B580";
const pairName = "Who will win Heat vs. Hawks, April 19";
const longSynthName = "Heat Long Token";
const longSynthSymbol = "Heat-l";
const shortSynthName = "Hawks Short Token";
const shortSynthSymbol = "Hawks-s";

// Optional LSP Params
const ancillaryData =
  "q: title: NBA: Who will win Heat vs. Hawks, scheduled for April 19, 7:30 PM ET?, p1: 0, p2: 1, p3: 0.5. Where p2 corresponds to Heat, p1 to a Hawks, p3 to unknown";
const customAncillaryData = web3.utils.utf8ToHex(ancillaryData);
const optimisticOracleLivenessTime = 60;
const optimisticOracleProposerBond = 0;
const proposerReward = 0;
const enableEarlyExpiration = true;

// FPL Params
const upperBound = toWei("1");
const lowerBound = toWei("0");

// Deploy contract and return its address.
const deploy = async () => {
  const [deployer] = await web3.eth.getAccounts();
  const financialProductLibrary = await getAddress("LinearLongShortPairFinancialProductLibrary", chainId);

  const lspParams = {
    pairName,
    expirationTimestamp,
    collateralPerPair,
    priceIdentifier,
    enableEarlyExpiration,
    longSynthName,
    longSynthSymbol,
    shortSynthName,
    shortSynthSymbol,
    collateralToken,
    financialProductLibrary,
    customAncillaryData,
    proposerReward,
    optimisticOracleLivenessTime,
    optimisticOracleProposerBond,
  };

  const transactionOptions = { gas: 10000000, gasPrice: 2000000000, from: deployer };

  console.log("Deploying a LSP contract for " + pairName);
  // Simulate transaction to test before sending to the network.

  const timeDelay = 10000;
  const delay = (milliseconds) => {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  };

  const lspAddress = await getAddress("LongShortPairCreator", chainId);
  const lspCreator = new web3.eth.Contract(getAbi("LongShortPairCreator"), lspAddress);
  const address = await lspCreator.methods.createLongShortPair(lspParams).call(transactionOptions);
  console.log("- The LSP contract address is " + address);

  // Since the simulated transaction succeeded, send the real one to the network.
  const { transactionHash } = await lspCreator.methods.createLongShortPair(lspParams).send(transactionOptions);
  console.log("- The contract was deployed in transaction " + transactionHash);

  console.log("Setting FPL parameters...");
  await delay(timeDelay);
  const deployedFPL = new web3.eth.Contract(
    getAbi("LinearLongShortPairFinancialProductLibrary"),
    financialProductLibrary
  );
  const fplParams = [address, upperBound, lowerBound];
  console.log("- The fpl params are :", { address: fplParams[0], upperBound: fplParams[1], lowerBound: fplParams[2] });

  const fpl = await deployedFPL.methods.setLongShortPairParameters(...fplParams).send(transactionOptions);
  console.log("- Financial product library parameters set in transaction: ", fpl.transactionHash);

  // Save lspAddress to file.
  const savePath = `${path.resolve(__dirname)}/latest-deployment-details.json`;
  fs.writeFileSync(savePath, JSON.stringify({ lspAddress: address }));
  console.log("Deployment address saved to", savePath);
};

// Run script.
deploy();
