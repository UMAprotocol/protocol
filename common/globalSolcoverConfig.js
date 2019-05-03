module.exports = {
  copyPackages: ["openzeppelin-solidity"],
  compileCommand: "../../node_modules/.bin/truffle compile",
  testCommand: "cp ../../common/globalTruffleConfig.js ./truffle-config.js && ../../node_modules/.bin/truffle test --network coverage",
  port: 8545,
  skipFiles: ["Migrations.sol", "echidna_tests", "test"]
};
