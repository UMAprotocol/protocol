import Finder from "contracts/Finder.json";
import Registry from "contracts/Registry.json";

const options = {
  contracts: [Registry, Finder],
  polls: {
    accounts: 3500,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
