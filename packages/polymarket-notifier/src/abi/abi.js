const binaryAdapterAbi = [
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "questions",
    outputs: [
      { internalType: "uint256", name: "resolutionTime", type: "uint256" },
      { internalType: "uint256", name: "reward", type: "uint256" },
      { internalType: "uint256", name: "proposalBond", type: "uint256" },
      { internalType: "uint256", name: "settled", type: "uint256" },
      { internalType: "uint256", name: "requestTimestamp", type: "uint256" },
      { internalType: "uint256", name: "adminResolutionTimestamp", type: "uint256" },
      { internalType: "bool", name: "earlyResolutionEnabled", type: "bool" },
      { internalType: "bool", name: "resolved", type: "bool" },
      { internalType: "bool", name: "paused", type: "bool" },
      { internalType: "address", name: "rewardToken", type: "address" },
      { internalType: "bytes", name: "ancillaryData", type: "bytes" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const ctfAdapterAbi = [
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "questions",
    outputs: [
      { internalType: "uint256", name: "requestTimestamp", type: "uint256" },
      { internalType: "uint256", name: "reward", type: "uint256" },
      { internalType: "uint256", name: "proposalBond", type: "uint256" },
      { internalType: "uint256", name: "emergencyResolutionTimestamp", type: "uint256" },
      { internalType: "bool", name: "resolved", type: "bool" },
      { internalType: "bool", name: "paused", type: "bool" },
      { internalType: "bool", name: "reset", type: "bool" },
      { internalType: "address", name: "rewardToken", type: "address" },
      { internalType: "address", name: "creator", type: "address" },
      { internalType: "bytes", name: "ancillaryData", type: "bytes" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

module.exports = { binaryAdapterAbi, ctfAdapterAbi };
