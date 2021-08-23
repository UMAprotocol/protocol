// End to end tests in this package are run using Mocha. This file fetches only those test files to run against. End to
// end tests, that should be run with mocha, are notated with `*.e2e.js` at the end of the file.

// There are other mocha tests in this package, such as those that test the index.js files. To make this config compatible
// with the existing tests, you must append `-e2e` to your mocha test command to run these tests. Else, simply run the
// `index.js` tests. This defaults these tests to be skipped in CI unless explicitly enabled with the flag.

let commonExport = {
  require: ["ts-node/register/transpile-only"],
  extension: ["js"],
  watchExtensions: ["js"],
  timeout: 100000,
};

if (!process.argv.includes("--e2e")) {
  console.log(
    "Running mocha tests but skipping e2e tests. To run e2e tests with mocha, append `--e2e` to the mocha test command."
  );
  module.exports = commonExport;
} else {
  const path = require("path");
  const { getAllFilesInPath } = require("@uma/common");

  // exit test runner on unhandled rejections
  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection during test execution:", promise, "reason:", reason);
    process.exit(1);
  });

  // Fetch an array of all test files in this package.
  const allTestFiles = getAllFilesInPath(path.resolve(__dirname, "./test"));
  // Select only the ones that end with `e2e.js`.
  const endToEndTests = allTestFiles.filter((path) => path.endsWith(".e2e.js"));

  module.exports = {
    ...commonExport,
    spec: endToEndTests, // mocha will run the set of test files defined in this array.
  };
}
