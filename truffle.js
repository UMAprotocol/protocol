module.exports = {
  // See <http://truffleframework.com/docs/advanced/configuration>
  // for more about customizing your Truffle configuration!
  networks: {
    development: {
      host: "127.0.0.1",
      port: 9545,
      network_id: "*", // Match any network id
      gas: 4700000
    },
    ci: {
      host: "127.0.0.1",
      port: 8545,
      network_id: 1234,
      gas: 4700000
    }
  }
};

