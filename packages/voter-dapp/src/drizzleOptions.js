import DesignatedVotingFactory from "@uma/core-1-2-0/build/contracts/DesignatedVotingFactory.json";
import Governor from "@uma/core-1-2-0/build/contracts/Governor.json";
import Voting from "@uma/core-1-2-0/build/contracts/Voting.json";
import VotingToken from "@uma/core-1-2-0/build/contracts/VotingToken.json";
import VotingInterfaceTesting from "@uma/core/build/contracts/VotingInterfaceTesting.json";

// Hack to add the new voting address on kovan and mainnet, but not change anything else.
Voting.networks[1].address = "0x8b1631ab830d11531ae83725fda4d86012eccd77";
Voting.networks[42].address = "0x0740C93a3D2B6088d0E345Da47c3B412b9874562";
Voting.abi = VotingInterfaceTesting.abi;

const options = {
  contracts: [DesignatedVotingFactory, Governor, Voting, VotingToken],
  polls: {
    accounts: 1000,
    blocks: 3000
  },
  syncAlways: true
};

export default options;
