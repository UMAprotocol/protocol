import Registry from "./contracts/Registry.json";
import TokenizedDerivativeCreator from "./contracts/TokenizedDerivativeCreator.json";

const options = {
  contracts: [Registry, TokenizedDerivativeCreator],
  events: {},
  polls: {
    accounts: 1500
  }
};

export default options;
