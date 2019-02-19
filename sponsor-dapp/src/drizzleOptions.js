import Registry from "./contracts/Registry.json";
import TokenizedDerivativeCreator from "./contracts/TokenizedDerivativeCreator.json";
import AddressWhitelist from "./contracts/AddressWhitelist.json";

const options = {
  contracts: [Registry, TokenizedDerivativeCreator, AddressWhitelist],
  events: {},
  polls: {
    accounts: 1500,
    blocks: 1500
  }
};

export default options;
