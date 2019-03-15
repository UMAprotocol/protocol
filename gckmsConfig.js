const argv = require("minimist")(process.argv.slice());


function getStaticConfig() {
  // The anatomy of an individual config is:
  //   projectId: ID of a Google Cloud project
  //   keyRingId: ID of keyring
  //   cryptoKeyId: ID of the crypto key to use for decrypting the key material
  //   locationId: Google Cloud location, e.g., 'global'.
  //   ciphertextBucket: ID of a Google Cloud storage bucket.
  //   ciphertextFilename: Name of a file within `ciphertextBucket`.
  return {
    main: {
      registry: {},
      oracle: {},
      store: {},
      priceFeed: {},
      sponsorWhitelist: {},
      returnCalculatorWhitelist: {},
      marginCurrencyWhitelist: {},
    },
    ropsten: {
      registry: {},
      oracle: {},
      store: {},
      priceFeed: {},
      sponsorWhitelist: {},
      returnCalculatorWhitelist: {},
      marginCurrencyWhitelist: {},
    },
    private: {
      deployer: {},
      registry: {},
      oracle: {},
      store: {},
      priceFeed: {},
      sponsorWhitelist: {},
      returnCalculatorWhitelist: {},
      marginCurrencyWhitelist: {},
      // Note: remove this once other private configs are populated.
      example: {
        projectId: "risk-protocol",
        locationId: "global",
        keyRingId: "Yutaro_Test",
        cryptoKeyId: "yutaro",
        ciphertextBucket: "risk-labs-local-test",
        ciphertextFilename: "taro_local_mnemonic.enc"
      }
    }
  };
};

function getNetworkName() {
  switch(argv.network) {
  case "mainnet":
    return "main";
  case "ropsten":
    return "ropsten";
  default:
    return "private";
}
}

const staticConfig = getStaticConfig();
const networkConfig = staticConfig[getNetworkName()];

const keyConfigs = [];
for (let keyName of argv.keys) {
  keyConfigs.push(networkConfig[keyName]);
}

module.exports = keyConfigs;