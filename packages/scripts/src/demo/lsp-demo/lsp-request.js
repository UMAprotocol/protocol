#!/usr/bin/env node

// To run the script, include the MNEMONIC and CUSTOM_NODE_URL variables in a .env file. Run the following command (from repo root):
// HARDHAT_NETWORK=kovan node ./packages/scripts/src/demo/lsp-demo/lsp-request.js

// Helper modules
const { getContract, web3 } = require("hardhat");
const { lspAddress } = require("./latest-deployment-details.json");

// Constants to update
const requestTimestamp = Math.floor(Date.now() / 1000) - 100;

// Request a price from the Optimistic Oracle contract
const request = async () => {
  const [deployer] = await web3.eth.getAccounts();
  const LongShortPair = getContract("LongShortPair");
  const lspContract = new web3.eth.Contract(LongShortPair.abi, lspAddress);
  console.log("Requesting a price from the Optimistic Oracle contract...");
  await lspContract.methods.requestEarlyExpiration(requestTimestamp).send({ from: deployer });
  console.log(
    "- Requested an early expiration. See https://optimistic-oracle-dapp-5liuk09wg-uma.vercel.app/ to propose price."
  );
};

// Main script.
request();
