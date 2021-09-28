import { task, types } from "hardhat/config";
import { CombinedHRE } from "./types";

const { ZERO_ADDRESS } = require("@uma/common");

task("deploy-across-pool", "Deploys an L1 across pool and whitelists it within the BrideAdmin")
  .addParam("lptokenname", "Name of the LP tokens deployed for the pool", undefined, types.string)
  .addParam("lptokensymbol", "Symbol of the LP tokens deployed for the pool", undefined, types.string)
  .addParam("l1tokenaddress", "Address of the token on L1", undefined, types.string)
  .addParam("lpfeeratepersecond", "Scales the amount of pending fees per second paid to LPs", undefined, types.string)
  .setAction(async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE;
    const { deployments, getNamedAccounts, web3 } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    const { lptokenname, lptokensymbol, l1tokenaddress, lpfeeratepersecond } = taskArguments;

    const BridgeAdmin = await deployments.get("BridgeAdmin");
    const bridgeAdmin = new web3.eth.Contract(BridgeAdmin.abi, BridgeAdmin.address);
    console.log(`Loaded BridgeAdmin @ ${bridgeAdmin.options.address}`);
    console.log(`Deploying bridgePool`);

    const args = [
      lptokenname, // _lpTokenName
      lptokensymbol, // _lpTokenSymbol
      bridgeAdmin.options.address, // _bridgeAdmin
      l1tokenaddress, // _l1Token
      lpfeeratepersecond, // _lpFeeRatePerSecond
      ZERO_ADDRESS, // _timer
    ];

    const bridgePool = await deploy("BridgePool", { from: deployer, args, log: true });

    console.log("Bridge pool deployed @ ", bridgePool.address);
  });
