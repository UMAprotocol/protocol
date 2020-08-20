// This simple script tells you how big your contract byte code is and how much you have until you exceed
// the current block limit as defined by EIP170. This script should be run from the /core directory.
// To run the script navigate to /core and then run:
// truffle exec -c ./scripts/local/CalculateContractBytecode.js --contract Voting --network test
// where voting is the name of the contract you want to check.

const argv = require("minimist")(process.argv.slice(), { string: ["contract"] });

module.exports = async function(callback) {
  if (!argv.contract) {
    console.log("Please enter the contract name as a parameter as `--contract <name>`.");
    callback();
  }

  // Load contracts into script and output info.
  console.log("loading", argv.contract + ".json");
  let obj = require("./../../build/contracts/" + argv.contract + ".json");
  const byteCodeSize = (obj.deployedBytecode.length - 2) / 2;
  const remainingSize = 2 ** 14 + 2 ** 13 - byteCodeSize;
  console.log("Contract is", byteCodeSize, "bytes in size.");
  console.log("This leaves a total of", remainingSize, "bytes within the EIP170 limit.");
  callback();
};
