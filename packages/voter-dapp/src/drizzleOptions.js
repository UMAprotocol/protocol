import DesignatedVotingFactory from "@uma/core/build/contracts/DesignatedVotingFactory.json";
import Governor from "@uma/core/build/contracts/Governor.json";
import Voting from "@uma/core/build/contracts/Voting.json";
import VotingToken from "@uma/core/build/contracts/VotingToken.json";
import VotingAncillaryTest from "@uma/core/build/contracts/VotingAncillaryInterfaceTesting.json";

// Doing this to force using only the ancillary interface. Drizzle was getting confused when calling overloads.
Voting.abi = [...VotingAncillaryTest.abi];
const OldDesignatedVotingFactory = {
  abi: DesignatedVotingFactory.abi,
  networks: {
    ...DesignatedVotingFactory.networks, // Unless overridden, this will make the "old" voting contract == new voting contract.
    1: {
      address: "0xE81EeE5Da165fA6863bBc82dF66E62d18625d592"
    },
    42: {
      address: "0xF988f9f62f355966a758c5936C9080183C176585"
    }
  },
  contractName: "OldDesignatedVotingFactory"
};

const options = {
  contracts: [DesignatedVotingFactory, Governor, Voting, VotingToken, OldDesignatedVotingFactory],
  polls: {
    accounts: 1000,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
