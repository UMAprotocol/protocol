usePlugin("@nomiclabs/buidler-truffle5");
usePlugin("solidity-coverage");

module.exports = {
  solc: {
    version: "0.6.6",
    optimizer: {
      enabled: true,
      runs: 200
    }
  },
  networks: {
    buidlerevm: {
      gas: 9000000,
      blockGasLimit: 0x1fffffffffffff,
      allowUnlimitedContractSize: true,
      timeout: 1800000
    },
    localhost: {
      url: "http://127.0.0.1:8545"
    }
  }
};
