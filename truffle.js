module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // for more about customizing your Truffle configuration!
  networks: {
    ci: {
      host: "127.0.0.1",
      port: 8545,
      network_id: 1234,
      gas: 4700000
    },
    coverage: {
      host: "127.0.0.1",
      network_id: "*",
      port: 8545,
      gas: 0xfffffffffff,
      gasPrice: 0x01
    },
    ci_coverage: {
      host: "127.0.0.1",
      network_id: 12345,
      port: 8545,
      gas: 0xfffffffffff,
      gasPrice: 0x01
    }
  }
};
