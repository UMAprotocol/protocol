import Finder from "contracts/Finder.json";
import Registry from "contracts/Registry.json";
import Voting from "contracts/Voting.json";
import IdentifierWhitelist from "contracts/IdentifierWhitelist.json";
import ManualPriceFeed from "contracts/ManualPriceFeed.json";
import TokenizedDerivativeCreator from "contracts/TokenizedDerivativeCreator.json";
import LeveragedReturnCalculator from "contracts/LeveragedReturnCalculator.json";
import TestnetERC20 from "contracts/TestnetERC20.json";

const options = {
  contracts: [
    Registry,
    Finder,
    Voting,
    IdentifierWhitelist,
    ManualPriceFeed,
    TokenizedDerivativeCreator,
    LeveragedReturnCalculator,
    TestnetERC20
  ],
  polls: {
    accounts: 3500,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
