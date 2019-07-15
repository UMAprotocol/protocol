import Voting from "./contracts/Voting.json";

const options = {
  contracts: [Voting],
  polls: {
    accounts: 1000,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
