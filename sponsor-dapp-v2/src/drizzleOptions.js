import Finder from "contracts/Finder.json";

const options = {
  contracts: [Finder],
  polls: {
    accounts: 3500,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
