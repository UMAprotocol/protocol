// This library has two functions that it exports: getAllContracts() and getAbiDecoder().
//
// getAllContracts() returns an array of all JSON artifacts from the core/build/contracts directory.
//
// getAbiDecoder returns an abi decoder (see https://github.com/UMAprotocol/abi-decoder) object preloaded with the ABIs
// pulled from the core/build/contracts directory. Example usage:
// getAbiDecoder().decodeMethod(data); // This decodes the txn data into the function name and arguments.

const abiDecoder = require("abi-decoder");

function importAll(r) {
  return r.keys().map(r);
}

function getAllContracts() {
  let importedObjects;

  // Note: we use a try here because we don't want to install the require-context package in node.js contexts where
  // it won't work.
  if (process.browser) {
    // This only works in webpack.
    // eslint-disable-next-line no-unused-vars
    const requireContext = require("require-context");

    // Note: all arguments must be hardcoded here for webpack to bundle the files correctly.
    // This line also generates a few build warnings that should be ignored.
    const contractContext = require.context("@uma/core/build/contracts/", true, /\.json$/);

    importedObjects = importAll(contractContext);
  } else {
    // This only works in node.js.
    const fs = require("fs");
    const path = require("path");
    const packageDir = path.dirname(require.resolve("@uma/core/package.json"));
    const contractsPath = path.join(packageDir, "build/contracts/");

    const fileList = fs.readdirSync(contractsPath).filter((name) => name.match(/\.json$/));
    importedObjects = fileList.map((filename) => {
      const fileContents = fs.readFileSync(path.join(contractsPath, filename));
      return JSON.parse(fileContents);
    });
  }

  return importedObjects;
}

function getAbiDecoder() {
  const contracts = getAllContracts();
  for (const contract of contracts) {
    abiDecoder.addABI(contract.abi);
  }

  return abiDecoder;
}

module.exports = { getAllContracts, getAbiDecoder };
