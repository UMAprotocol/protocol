// Pre-loaded wallets from Optimism docker containers with 10k eth on both L1 and L2.
const DEFAULT_ADMIN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OTHER_WALLET_KEY = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97";

// To correctly deploy on optimism, some settings need to be set.
const OPTIMISM_GAS_OPTS = { gasLimit: 10_000_000, gasPrice: 0 };

// Addresses of some key Optimism contracts deployed in the default Optimism container setup. Not exported by any
// optimism packages. You can view them at http://localhost:8080/addresses.json when running the containers.
const PROXY__OVM_L1_CROSS_DOMAIN_MESSENGER = "0x59b670e9fa9d0a427751af201d676719a970857b";
const OVM_STATE_COMMITMENT_CHAIN = "0x9A676e781A523b5d0C0e43731313A708CB607508";

module.exports = {
  DEFAULT_ADMIN_KEY,
  OTHER_WALLET_KEY,
  OPTIMISM_GAS_OPTS,
  PROXY__OVM_L1_CROSS_DOMAIN_MESSENGER,
  OVM_STATE_COMMITMENT_CHAIN,
};
