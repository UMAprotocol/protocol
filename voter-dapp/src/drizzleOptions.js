import DesignatedVotingFactory from "./contracts/DesignatedVotingFactory.json";
import Voting from "./contracts/Voting.json";
import VotingToken from "./contracts/VotingToken.json";

const options = {
  contracts: [DesignatedVotingFactory, Voting, VotingToken],
  polls: {
    accounts: 1000,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
