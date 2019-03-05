import Registry from "./contracts/Registry.json";
import TokenizedDerivativeCreator from "./contracts/TokenizedDerivativeCreator.json";
import ManualPriceFeed from "./contracts/ManualPriceFeed.json";
import CentralizedOracle from "./contracts/CentralizedOracle.json";

const options = {
  contracts: [Registry, TokenizedDerivativeCreator, ManualPriceFeed, CentralizedOracle],
  events: {},
  polls: {
    accounts: 3500,
    blocks: 3500
  },
  syncAlways: true
};

export default options;
