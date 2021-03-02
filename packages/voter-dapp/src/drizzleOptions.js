import DesignatedVotingFactory from "@uma/core/build/contracts/DesignatedVotingFactory.json";
import Governor from "@uma/core/build/contracts/Governor.json";
import Voting from "@uma/core/build/contracts/Voting.json";
import VotingToken from "@uma/core/build/contracts/VotingToken.json";
import VotingAncillaryTest from "@uma/core/build/contracts/VotingAncillaryInterfaceTesting.json";

// Doing this to force using only the ancillary interface. Drizzle was getting confused when calling overloads.
Voting.abi = [...VotingAncillaryTest.abi];

const options = {
  contracts: [DesignatedVotingFactory, Governor, Voting, VotingToken],
  polls: {
    accounts: 1000,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
