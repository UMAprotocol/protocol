import { task, types } from "hardhat/config";
import type { CombinedHRE } from "./types";

// Use BLANK_FUNCTION_SIG if you don't want `deposit` or `executeProposal` to delegate a contract call.
const BLANK_FUNCTION_SIG = "0x00000000";
// Admin role on Bridge contract:
const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

task("register-generic-resource", "Admin can set generic resource ID on Bridge")
  .addParam("target", "Contract to delegate call to for this resource ID", undefined, types.string)
  .addOptionalParam("rname", "Resouce name to generate Resource ID", undefined, types.string)
  .addOptionalParam("cid", "Chain ID to generate Resource ID", undefined, types.int)
  .addOptionalParam(
    "id",
    "Custom resource ID if you don't want one generated from the --rname and --cid",
    undefined,
    types.string
  )
  .addOptionalParam("deposit", "Deposit function prototype string (e.g. func(uint256,bool))", "", types.string)
  .addOptionalParam("execute", "Contract to delegate call to for this resource ID", "", types.string)
  .setAction(async function (taskArguments, hre_) {
    const hre = hre_ as CombinedHRE; // Cast to the extended HRE.
    const { deployments, getNamedAccounts, web3 } = hre;
    const { deployer } = await getNamedAccounts();
    const { target, deposit, execute, rname, cid } = taskArguments;
    let { id } = taskArguments;

    const { utf8ToHex, sha3 } = web3.utils;

    // Returns first 4 bytes of the sha3 hash of the function name including types/
    const _getFunctionSignature = (functionPrototypeString: string) => {
      return sha3(utf8ToHex(functionPrototypeString))?.substr(0, 10);
    };

    const _getResourceId = (name: string, chainId: string) => {
      const encodedParams = web3.eth.abi.encodeParameters(["string", "uint8"], [name, chainId]);
      return web3.utils.soliditySha3(encodedParams);
    };

    if (rname || cid) {
      if (id) throw new Error("Cannot provide --cid or --rname with --id");
      if (!cid || !rname) throw new Error("Must provide --cid and --rname when generating the resource id");
      id = _getResourceId(rname, cid);
    } else if (!id) {
      throw new Error("Must --id when not using --cid and --rname to generate the resource id");
    }

    // Ensure that caller is an Admin on Bridge.
    const Bridge = await deployments.get("Bridge");
    const bridge = new web3.eth.Contract(Bridge.abi, Bridge.address);
    console.log(`Using Bridge @ ${bridge.options.address}`);
    const isAdmin = await bridge.methods.hasRole(DEFAULT_ADMIN_ROLE, deployer).call();
    if (!isAdmin) throw new Error("Deployer is not Admin for Bridge");

    const GenericHandler = await deployments.get("GenericHandler");
    const genericHandler = new web3.eth.Contract(GenericHandler.abi, GenericHandler.address);

    // Compute function signatures by hashing prototype strings:
    const depositFuncSig = deposit !== "" ? _getFunctionSignature(deposit) : BLANK_FUNCTION_SIG;
    const executeFuncSig = execute !== "" ? _getFunctionSignature(execute) : BLANK_FUNCTION_SIG;
    console.log(`Deposit function signature: ${depositFuncSig}`);
    console.log(`Execute function signature: ${executeFuncSig}`);
    console.log(
      `Registering generic resource ID ${id} with contract ${target} on handler @ ${genericHandler.options.address}`
    );

    const txn = await bridge.methods
      .adminSetGenericResource(genericHandler.options.address, id, target, depositFuncSig, executeFuncSig)
      .send({ from: deployer });
    console.log(`tx: ${txn.transactionHash}`);
  });
