import DesignatedVotingFactory from "@uma/core/build/contracts/DesignatedVotingFactory.json";
import Governor from "@uma/core/build/contracts/Governor.json";
import Voting from "@uma/core/build/contracts/Voting.json";
import VotingToken from "@uma/core/build/contracts/VotingToken.json";

// Hack to add the new voting address on kovan and mainnet, but not change anything else.
Voting.networks[1].address = "0x8b1631ab830d11531ae83725fda4d86012eccd77";
Voting.networks[42].address = "0x08f5728338de40a7b6fc35d30b0ca7cc622be6f3";

const options = {
  contracts: [DesignatedVotingFactory, Governor, Voting, VotingToken],
  polls: {
    accounts: 1000,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
