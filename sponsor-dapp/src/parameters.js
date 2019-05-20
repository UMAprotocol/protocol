import identifierConfig from "./identifiers.json";

const parameters = {
  main: {
    currencies: {
      "0x0000000000000000000000000000000000000000": "ETH",
      "0x89d24A6b4CcB1B6fAA2625fE562bDD9a23260359": "DAI",
      "0x0000000000085d4780B73119b644AE5ecd22b376": "TUSD"
    }
  },
  ropsten: {
    currencies: {
      "0x0000000000000000000000000000000000000000": "ETH",
      "0x188e7aC50648A2E44795eEF12cb54Cbf736de302": "DAI",
      "0xA7E2f86B4E2c241Ac6D2fb7cE9dEBb37DbB05093": "TUSD"
    }
  },
  private: {
    currencies: {
      "0x0000000000000000000000000000000000000000": "ETH"
    }
  },
  identifiers: {
    ...Object.entries(identifierConfig).reduce((joinedConfig, [identifier, config]) => {
      return { ...joinedConfig, [identifier]: config.dappConfig };
    }, {})
  }
};

export default parameters;
