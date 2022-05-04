#!/usr/bin/env node

// To run the script, include the MNEMONIC and CUSTOM_NODE_URL variables in a .env file. Run the following command (from repo root):
// HARDHAT_NETWORK=kovan node ./packages/scripts/src/demo/lsp-demo/lsp-proposal.js

// Helper modules
const { getAddress } = require("@uma/contracts-node");
const { getContract, web3 } = require("hardhat");
const { toBN, toWei } = web3.utils;
const { lspAddress } = require("./latest-deployment-details.json");

// Constants to update
const chainId = 42;
const proposedValue = toWei(toBN(1));

// Propose a price for the request.
const propose = async () => {
  const accounts = await web3.eth.getAccounts();
  const [deployer] = accounts;
  const optimisticOracleContract = await getContract("OptimisticOracle");
  const optimisticOracleAddress = await getAddress("OptimisticOracle", chainId);
  const optimisticOracle = new web3.eth.Contract(optimisticOracleContract.abi, optimisticOracleAddress);

  // Pull data from the request to use in the proposal
  const latestBlock = await web3.eth.getBlockNumber();
  const fromBlock = latestBlock - 10000;
  const requests = await optimisticOracle.getPastEvents("RequestPrice", { fromBlock: fromBlock });
  const lspRequest = requests
    .filter((request) => request.returnValues.requester === lspAddress)
    .map((request) => {
      return {
        timestamp: request.returnValues.timestamp,
        identifier: request.returnValues.identifier,
        ancillaryData: request.returnValues.ancillaryData,
      };
    });

  console.group("Proposing a value to the Optimistic Oracle for the price request...");
  await optimisticOracle.methods
    .proposePriceFor(
      accounts[0],
      lspAddress,
      lspRequest[0].identifier,
      lspRequest[0].timestamp,
      lspRequest[0].ancillaryData,
      proposedValue
    )
    .send({ from: deployer });
  console.log(`- Proposed a price of ${proposedValue}`);
};

// Main script.
propose();
