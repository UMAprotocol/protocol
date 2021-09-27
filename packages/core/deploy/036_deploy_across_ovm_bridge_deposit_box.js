// The L2 br

const argv = require("minimist")(process.argv.slice(), { string: ["bridgeadmin"] });

const { ZERO_ADDRESS } = require("@uma/common");
const func = async function (hre) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  // const BridgeAdmin = await deployments.get("BridgeAdmin");

  const args = [
    "0xC2cd5064Bbe7173E095a2d410CBc95fB6e5E3321", // _bridgeAdmin on L1
    1800, // minimumBridgingDelay of 30 mins
    ZERO_ADDRESS, // timer address
  ];

  console.log("deployer", deployer);
  console.log("args", args);

  console.log("argv", argv);

  // await deploy("OVM_BridgeDepositBox", { from: deployer, args, log: true });
};
module.exports = func;
func.tags = ["OVM_BridgeDepositBox"];
