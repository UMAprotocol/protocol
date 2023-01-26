require("dotenv").config();

// Use USDC as the default currency for all networks that have it whitelisted.
const ADDRESSES_FOR_NETWORK = {
  1: { defaultCurrency: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  5: { defaultCurrency: "0x07865c6E87B9F70255377e024ace6630C1Eaa37F" },
  10: { defaultCurrency: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607" },
  82: { defaultCurrency: "0xD86e243FC0007e6226B07c9A50C9d70D78299EB5" },
  100: { defaultCurrency: "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83" },
  137: { defaultCurrency: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" },
  288: { defaultCurrency: "0x66a2A913e447d6b4BF33EFbec43aAeF87890FBbc" },
  9001: { defaultCurrency: "0x51e44FfaD5C2B122C8b635671FCC8139dc636E82" },
  42161: { defaultCurrency: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8" },
  43114: { defaultCurrency: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
  80001: { defaultCurrency: "0x0FA8781a83E46826621b3BC094Ea2A0212e71B23" },
};
const func = async function (hre) {
  const { deployments, getNamedAccounts, getChainId } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const defaultLiveness = 7200; // 2 hours.
  const chainId = await getChainId();
  const Finder = await deployments.get("Finder");
  const defaultCurrency = process.env.OA_DEFAULT_CURRENCY || ADDRESSES_FOR_NETWORK[chainId]?.defaultCurrency;
  if (!defaultCurrency) {
    throw new Error("No default currency found for this network. Please set the OA_DEFAULT_CURRENCY env variable.");
  }
  const isOnWhitelist = await deployments.read("AddressWhitelist", "isOnWhitelist", defaultCurrency);
  if (!isOnWhitelist) {
    throw new Error("Default currency is not whitelisted.");
  }

  await deploy("OptimisticAsserter", {
    from: deployer,
    args: [Finder.address, defaultCurrency, defaultLiveness],
    log: true,
    skipIfAlreadyDeployed: true,
  });
};
module.exports = func;
func.tags = ["OptimisticAsserter"];
func.dependencies = ["Finder", "AddressWhitelist"];
