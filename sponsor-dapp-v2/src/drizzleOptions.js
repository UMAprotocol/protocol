import Finder from "contracts/Finder.json";
import Registry from "contracts/Registry.json";
import Voting from "contracts/Voting.json";
import ManualPriceFeed from "contracts/ManualPriceFeed.json";

const options = {
  contracts: [Registry, Finder, Voting, ManualPriceFeed],
  polls: {
    accounts: 3500,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
