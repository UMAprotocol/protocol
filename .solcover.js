module.exports = {
  copyPackages: ["openzeppelin-solidity"],
  compileCommand: "$(npm bin)/truffle compile",
  testCommand: "$(npm bin)/truffle test --network coverage",
  port: 8545,
};
