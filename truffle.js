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
    app: {
      host: "35.211.70.170",
      port: 63202,
      network_id: "*",
      gas: 6720000
    },
  },
  compilers: {
    solc: {
      version: "0.4.25"
    }
  }
};
