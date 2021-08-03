// This library has two functions that it exports: getAllContracts() and getAbiDecoder().
//
// getAllContracts() returns an array of all JSON artifacts from the core/build/contracts directory.
//
// getAbiDecoder returns an abi decoder (see https://github.com/UMAprotocol/abi-decoder) object preloaded with the ABIs
// pulled from the core/build/contracts directory. Example usage:
// getAbiDecoder().decodeMethod(data); // This decodes the txn data into the function name and arguments.

import abiDecoder from "abi-decoder";

interface Context {
  keys: () => string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (input: string): any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function importAll(r: Context): any[] {
  return r.keys().map(r);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAllContracts(): any[] {
  let importedObjects;

  // Note: we use a try here because we don't want to install the require-context package in node.js contexts where
  // it won't work.
  const castedProcess = (process as unknown) as { browser: true };
  if (castedProcess.browser) {
    // This only works in webpack.
    // eslint-disable-next-line no-unused-vars
    require("require-context");

    // Note: all arguments must be hardcoded here for webpack to bundle the files correctly.
    // This line also generates a few build warnings that should be ignored.
    const castedRequire = (require as unknown) as {
      context: (path: string, useSubdirectories: boolean, regex: RegExp) => Context;
    };
    const contractContext = castedRequire.context("@uma/core/build/contracts/", true, /\.json$/);

    importedObjects = importAll(contractContext);
  } else {
    // This only works in node.js.
    const fs = require("fs");
    const path = require("path");
    const packageDir = path.dirname(require.resolve("@uma/core/package.json"));
    const contractsPath = path.join(packageDir, "build/contracts/");

    const fileList = fs.readdirSync(contractsPath).filter((name: string) => name.match(/\.json$/));
    importedObjects = fileList.map((filename: string) => {
      const fileContents = fs.readFileSync(path.join(contractsPath, filename));
      return JSON.parse(fileContents);
    });
  }

  return importedObjects;
}

export function getAbiDecoder(): typeof abiDecoder {
  const contracts = getAllContracts();
  for (const contract of contracts) {
    abiDecoder.addABI(contract.abi);
  }

  return abiDecoder;
}
