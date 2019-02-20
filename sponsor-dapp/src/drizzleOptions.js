import Registry from "./contracts/Registry.json";
import TokenizedDerivativeCreator from "./contracts/TokenizedDerivativeCreator.json";

const options = {
  contracts: [Registry, TokenizedDerivativeCreator],
  events: {},
  polls: {
    accounts: 3500,
    blocks: 3500
  }
};

export default options;
