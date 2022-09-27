// Accounts we will request to impersonate on hardhat node.
const REQUIRED_SIGNER_ADDRESSES = {
  deployer: "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D",
  foundation: "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D",
  account_with_uma: "0xcb287f69707d84cbd56ab2e7a4f32390fa98120b",
};

// Net ID that this script should simulate with.
const PROD_NET_ID = 1;

// Wallets we need to use to sign transactions.
const SECONDS_PER_DAY = 90;
const YES_VOTE = "1";
// Need to sign this message to take an UMA voting token snapshot before any votes can be revealed.
const SNAPSHOT_MESSAGE = "Sign For Snapshot";

module.exports = { REQUIRED_SIGNER_ADDRESSES, PROD_NET_ID, SECONDS_PER_DAY, YES_VOTE, SNAPSHOT_MESSAGE };
