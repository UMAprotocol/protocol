import Registry from "contracts/Registry.json";

const options = {
  contracts: [Registry],
  polls: {
    accounts: 3500,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
