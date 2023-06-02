// Accounts we will request to impersonate on hardhat node.
const REQUIRED_SIGNER_ADDRESSES = {
  deployer: "0x2bAaA41d155ad8a4126184950B31F50A1513cE25",
  foundation: "0x8180d59b7175d4064bdfa8138a58e9babffda44a",
};

// Net ID that this script should simulate with.
const PROD_NET_ID = 1;

// Wallets we need to use to sign transactions.
const SECONDS_PER_DAY = 86400;
const YES_VOTE = "1";
// Need to sign this message to take an UMA voting token snapshot before any votes can be revealed.
const SNAPSHOT_MESSAGE = "Sign For Snapshot";

module.exports = { REQUIRED_SIGNER_ADDRESSES, PROD_NET_ID, SECONDS_PER_DAY, YES_VOTE, SNAPSHOT_MESSAGE };
