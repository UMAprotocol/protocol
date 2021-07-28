// End to end tests in this package are run using Mocha. This file fetches only those test files to run against. End to
// end tests, that should be run with mocha, are notated with `*.e2e.js` at the end of the file.

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
  require: ["ts-node/register/transpile-only"],
  extension: ["js"],
  watchExtensions: ["js"],
  spec: endToEndTests,
  timeout: 80000,
};
