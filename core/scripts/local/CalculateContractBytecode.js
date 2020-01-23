// This simple script tells you how big your contract byte code is and how much you have until you exceed
// the current block limit as defined by EIP170. This script should be run from the /core directory.
// To run the script navigate to /core and then run:
// node scripts/local/CalculateContractBytecode.js --contract Voting
// where voting is the name of the contract you want to check.

const argv = require("minimist")(process.argv.slice(), { string: ["contract"] });
const contractName = argv.contract;

if (!contractName) {
  console.log("Please enter the contract name as a parameter as `--contract <name>`.");
  return;
}
const child = require("child_process").exec("$(npm bin)/truffle compile");
child.stdout.pipe(process.stdout);
child.on("exit", function() {
  console.log("loading", contractName + ".json");
  let obj = require("./../../build/contracts/" + contractName + ".json");

  const byteCodeSize = (obj.bytecode.length - 2) / 2;
  const remainingSize = 2 ** 14 + 2 ** 13 - byteCodeSize;
  console.log("Contract is", byteCodeSize, "bytes in size.");
  console.log("This leaves a total of", remainingSize, "bytes within the EIP170 limit.");

  process.exit();
});
