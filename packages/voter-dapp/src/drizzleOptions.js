import DesignatedVotingFactory from "@umaprotocol/core/build/contracts/DesignatedVotingFactory.json";
import Governor from "@umaprotocol/core/build/contracts/Governor.json";
import Voting from "@umaprotocol/core/build/contracts/Voting.json";
import VotingToken from "@umaprotocol/core/build/contracts/VotingToken.json";

const options = {
  contracts: [DesignatedVotingFactory, Governor, Voting, VotingToken],
  polls: {
    accounts: 1000,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
