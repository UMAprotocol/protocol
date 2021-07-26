// ensure NODE_ENV
process.env.NODE_ENV = "test";

// exit test runner on unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection during test execution:", promise, "reason:", reason);
  process.exit(1);
});

module.exports = {
  require: ["ts-node/register/transpile-only"],
  extension: ["js"],
  watchExtensions: ["js"],
  spec: ["test/insured-bridge/e2e_InsuredBridge.js"],
  timeout: 80000,
};
