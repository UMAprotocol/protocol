module.exports = {
  copyPackages: ["openzeppelin-solidity"],
  compileCommand: "npx truffle compile",
  testCommand: "npx truffle test --network ci_coverage",
  norpc: true
};
