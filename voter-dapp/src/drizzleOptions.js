import Voting from "./contracts/Voting.json";
import VotingToken from "./contracts/VotingToken.json";

const options = {
  contracts: [Voting, VotingToken],
  polls: {
    accounts: 1000,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
