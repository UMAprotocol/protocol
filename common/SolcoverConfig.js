const SolcoverConfig = {
  providerOptions: {
    network_id: 1234
  },
  skipFiles: [
    "Migrations.sol",
    "tokenized-derivative/echidna-tests",
    "common/test",
    "oracle/test",
    "oracle/implementation/test"
  ]
};

module.exports = { SolcoverConfig };
