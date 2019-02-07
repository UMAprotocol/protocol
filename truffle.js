const HDWalletProvider = require("truffle-hdwallet-provider");
const mnemonic = process.env.MNEMONIC
  ? process.env.MNEMONIC
  : "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat";

module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // for more about customizing your Truffle configuration!
  networks: {
    ci: {
      host: "127.0.0.1",
      port: 8545,
      network_id: 1234,
      gas: 6720000
    },
    coverage: {
      host: "127.0.0.1",
      network_id: "*",
      port: 8545,
      gas: 0xfffffffffff,
      gasPrice: 0x01
    },
    develop: {
      host: "127.0.0.1",
      port: 9545,
      network_id: "*",
      gas: 6720000
    },
    test: {
      host: "127.0.0.1",
      port: 9545,
      network_id: "*",
      gas: 6720000
    },
    ropsten: {
      provider: new HDWalletProvider(mnemonic, "https://ropsten.infura.io/v3/38504d9908d94d93a7692eaa900da084", 0, 2),
      network_id: "*",
      gas: 6720000,
      gasPrice: 20000000000
    },
    mainnet: {
      provider: new HDWalletProvider(mnemonic, "https://mainnet.infura.io/v3/38504d9908d94d93a7692eaa900da084", 0, 2),
      network_id: "*",
      gas: 6720000,
      gasPrice: 20000000000
    }
  }
};
