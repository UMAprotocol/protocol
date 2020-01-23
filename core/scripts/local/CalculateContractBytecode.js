// This simple script tells you how big your contract byte code is and how much you have until you exceed
// the current block limit as defined by EIP170.

const argv = require("minimist")(process.argv.slice(), { string: ["contract"] });
const contractName = argv.contract;

if (!contractName) {
  console.log("Please enter the contract name as a parameter as `--contract <name>`.");
  return;
}

console.log("loading", contractName + ".json");
let obj = require("./../../build/contracts/" + contractName + ".json");

const byteCodeSize = (obj.bytecode.length - 2) / 2;
const remainingSize = 2 ** 14 + 2 ** 13 - (obj.bytecode.length - 2) / 2;
console.log("Contract is", byteCodeSize, "bytes in size.");
console.log("This leaves a total of", remainingSize, "bytes within the EIP170 limit.");
