// This simple script tells you how big your contract byte code is and how much you have until you exceed
// the current block limit as defined by EIP170. This script should be run from the /core directory.
// To run the script navigate to /core and then run:
// yarn truffle compile && yarn hardhat compile && yarn truffle exec --network test ./scripts/local/CalculateContractBytecode.js --contract Voting
// where voting is the name of the contract you want to check.

const argv = require("minimist")(process.argv.slice(), { string: ["contract"] });

function printBytecodeInfo(path) {
  // Load contracts into script and output info.
  const obj = require(path);
  const byteCodeSize = (obj.deployedBytecode.length - 2) / 2;
  const remainingSize = 2 ** 14 + 2 ** 13 - byteCodeSize;
  console.log("Contract is", byteCodeSize, "bytes in size.");
  console.log("This leaves a total of", remainingSize, "bytes within the EIP170 limit.");
}

module.exports = async function (callback) {
  if (!argv.contract) {
    console.log("Please enter the contract name as a parameter as `--contract <name>`.");
    callback();
  }

  // Truffle
  console.group("Truffle Compilation Output");
  printBytecodeInfo("./../../build/contracts/" + argv.contract + ".json");
  console.groupEnd();

  // hardhat
  console.group("hardhat Compilation Output");
  printBytecodeInfo("./../../artifacts/" + argv.contract + ".json");
  console.groupEnd();

  callback();
};
