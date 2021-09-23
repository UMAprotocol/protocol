#!/usr/bin/env node

const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");

// Main script.
const main = async () => {
  await runDefaultFixture(hre, false);
  console.log("Done!");
};

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error.stack);
    process.exit(1);
  }
);
