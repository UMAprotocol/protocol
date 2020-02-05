import DesignatedVotingFactory from "./contracts/DesignatedVotingFactory.json";
import Governor from "./contracts/Governor.json";
import Voting from "./contracts/Voting.json";
import VotingToken from "./contracts/VotingToken.json";

const options = {
  contracts: [DesignatedVotingFactory, Governor, Voting, VotingToken],
  polls: {
    accounts: 1000,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
