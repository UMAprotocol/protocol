import Registry from "./contracts/Registry.json";
import TokenizedDerivativeCreator from "./contracts/TokenizedDerivativeCreator.json";
import ManualPriceFeed from "./contracts/ManualPriceFeed.json";
import CentralizedOracle from "./contracts/CentralizedOracle.json";
import AddressWhitelist from "./contracts/AddressWhitelist.json";

const options = {
  contracts: [
    AddressWhitelist,
    Registry,
    TokenizedDerivativeCreator,
    ManualPriceFeed,
    CentralizedOracle
  ],
  events: {},
  polls: {
    accounts: 3500,
    blocks: 3500
  }
};

export default options;
