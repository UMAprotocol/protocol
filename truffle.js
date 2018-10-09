module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // for more about customizing your Truffle configuration!
  networks: {
    ci: {
      host: "localhost",
      port: 8545,
      network_id: 1234,
      gas: 4700000
    },
    coverage: {
      host: "localhost",
      network_id: "*",
      port: 8555,
      gas: 0xfffffffffff,
      gasPrice: 0x01
    },
    ci_coverage: {
      host: "localhost",
      network_id: 12345,
      port: 8545,
      gas: 0xfffffffffff,
      gasPrice: 0x01
    }
  }
};
