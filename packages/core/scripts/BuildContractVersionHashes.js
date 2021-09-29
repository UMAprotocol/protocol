#!/usr/bin/env node

const { getContract, web3 } = require("hardhat");
const assert = require("assert");
const path = require("path");
const fs = require("fs");

const { soliditySha3 } = web3.utils;

const buildVersion = "2.0.1"; // this is the version that will be built and appended to the FindContractVersion util.

async function buildHashes(contractType) {
  assert(contractType == "Perpetual" || contractType == "ExpiringMultiParty", "Invalid contract type defined!");

  return soliditySha3(getContract(contractType).deployedBytecode);
}

function saveContractHashArtifacts(contractHashes) {
  const savePath = `${path.resolve(__dirname)}/../build/contract-type-hash-map.json`;
  fs.writeFileSync(savePath, JSON.stringify(contractHashes));
}

async function main() {
  const contractHashesToGenerate = ["Perpetual", "ExpiringMultiParty"];
  let versionMap = {};
  for (const contractType of contractHashesToGenerate) {
    const contractHash = await buildHashes(contractType);
    versionMap[contractHash] = { contractType, contractVersion: buildVersion };
  }
  saveContractHashArtifacts(versionMap);
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err.stack);
    process.exit(1);
  }
);
