// Pre-loaded wallet from Optimism docker containers with 10k eth on both L1 and L2.
const DEFAULT_ADMIN_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// To correctly deploy on optimism, some settings need to be set.
const OPTIMISM_GAS_OPTS = { gasLimit: 12_500_000, gasPrice: 0 };

// Address of the proxied cross-domain messenger deployed in the default Optimism container. Not exported by the package.
const PROXY__OVM_L1_CROSS_DOMAIN_MESSENGER = "0x59b670e9fa9d0a427751af201d676719a970857b";

module.exports = { DEFAULT_ADMIN_KEY, OPTIMISM_GAS_OPTS, PROXY__OVM_L1_CROSS_DOMAIN_MESSENGER };
