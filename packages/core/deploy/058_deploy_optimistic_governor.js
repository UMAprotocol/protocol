require("dotenv").config();

// Deploys the mastercopy of the OptimisticGovernor contract. It is not intended to be used directly, but rather to be
// used when deploying minimal proxy contracts that delegate calls this mastercopy. Constructor arguments are arbitrary
// here, just to satisfy the requirements of OptimisticGovernor constructor and make sure that the mastercopy is not
// usable directly. Proxy contracts can be deployed using the ModuleProxyFactory from Gnosis Zodiac at
// https://github.com/gnosis/zodiac/blob/master/contracts/factory/ModuleProxyFactory.sol and passing encoded bytes data
// in its deployModule method's initializer parameter to call setUp on the deployed proxy contract.

const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const Finder = await deployments.get("Finder");
  const owner = "0x000000000000000000000000000000000000dEaD"; // Mastercopy contract should not be usable directly.
  const collateral = await deployments.read("OptimisticOracleV3", "defaultCurrency");
  const bondAmount = 0;
  const rules = "mastercopy";
  const identifier = await deployments.read("OptimisticOracleV3", "defaultIdentifier");
  const liveness = await deployments.read("OptimisticOracleV3", "defaultLiveness");

  await deploy("OptimisticGovernor", {
    from: deployer,
    args: [Finder.address, owner, collateral, bondAmount, rules, identifier, liveness],
    log: true,
    skipIfAlreadyDeployed: false,
  });
};
module.exports = func;
func.tags = ["OptimisticGovernor"];
func.dependencies = ["Finder", "AddressWhitelist", "IdentifierWhitelist", "OptimisticOracleV3"];
