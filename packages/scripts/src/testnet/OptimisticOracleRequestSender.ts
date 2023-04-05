// This script is used to help test OO interfaces on testnets by producing a set of OO requests.

import { getContractInstance } from "../utils/contracts";

import {
  OptimisticOracleEthers,
  OptimisticOracleV2Ethers,
  SkinnyOptimisticOracleEthers,
  OptimisticOracleV3Ethers,
} from "@uma/contracts-node";

const hre = require("hardhat");
const { ethers } = hre;

const ancillaryData =
  "0x713a207469746c653a2057696c6c20446f6e616c64204a2e205472756d7020626520696e64696374656420627920417072696c2031343f2c206465736372697074696f6e3a2054686973206d61726b65742077696c6c207265736f6c766520746f20e2809c596573e2809d20696620616e79204665646572616c206f72205374617465206a7572697364696374696f6e206f662074686520556e697465642053746174657320756e7365616c73206f72206f7468657277697365206f6666696369616c6c7920616e6e6f756e6365732061206372696d696e616c20696e646963746d656e74206f6620666f726d657220507265736964656e7420446f6e616c64205472756d70206265666f726520746865207265736f6c7574696f6e2074696d6520417072696c2031342c20323032332c2031313a35393a353920504d2045542e204f74686572776973652c2074686973206d61726b65742077696c6c207265736f6c766520746f20e2809c4e6fe2809d2e0a0a506c65617365206e6f74652c20666f7220707572706f736573206f662074686973206d61726b65742c20746865204469737472696374206f6620436f6c756d62696120616e6420616e7920636f756e74792c206d756e69636970616c6974792c206f72206f74686572207375626469766973696f6e206f662061205374617465207368616c6c20626520696e636c756465642077697468696e2074686520646566696e6974696f6e206f6620612053746174652e0a4e6f746520616c736f2c207468617420616e20696e646963746d656e74207468617420686173206265656e20697373756564206265666f726520746865207265736f6c7574696f6e2074696d65206275742072656d61696e73207365616c6564206f72206f74686572776973652073656372657420617420746865207265736f6c7574696f6e2074696d652077696c6c206e6f7420626520636f6e7369646572656420696e2074686973206d61726b65742e207265735f646174613a2070313a20302c2070323a20312c2070333a20302e352e20576865726520703120636f72726573706f6e647320746f204e6f2c20703220746f205965732c20703320746f20756e6b6e6f776e2f35302d35302c696e697469616c697a65723a393134333063616432643339373537363634393937313766613064363661373864383134653563352c6f6f5265717565737465723a366139643232323631366339306663613537353463643133333363666439623766623661346637342c6368696c645265717565737465723a656533616665333437643563373433313730343165323631386334393533346461663838376332342c6368696c64436861696e49643a313337";

const approvedIdentifier = "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000";

const goerliUsdc = "0x07865c6E87B9F70255377e024ace6630C1Eaa37F";

const requestTime = Math.floor(new Date().valueOf() / 1000) - 1000;

async function main() {
  console.log("Running OptimisticOracleRequestSender script 🚀");

  const chainId = (await ethers.provider.getNetwork()).chainId;

  if (!chainId || chainId != 5) throw new Error("This script should be run on goerli");

  //   OO v1.
  const optimisticOracle = await getContractInstance<OptimisticOracleEthers>("OptimisticOracle", undefined, 5);
  console.log("Sending requests to OptimisticOracle", optimisticOracle.address);
  const ooTx = await optimisticOracle.requestPrice(approvedIdentifier, requestTime, ancillaryData, goerliUsdc, "0");
  ooTx.wait();
  console.log("Sent request to OptimisticOracle", ooTx.hash);

  //   OO v2.
  const optimisticOracleV2 = await getContractInstance<OptimisticOracleV2Ethers>("OptimisticOracleV2", undefined, 5);
  console.log("Sending requests to OptimisticOracleV2", optimisticOracleV2.address);
  const ooV2Tx = await optimisticOracleV2.requestPrice(approvedIdentifier, requestTime, ancillaryData, goerliUsdc, "0");
  ooV2Tx.wait();
  console.log("Sent request to OptimisticOracleV2", ooV2Tx.hash);

  //   OO Skinny.
  const skinnyOptimisticOracle = await getContractInstance<SkinnyOptimisticOracleEthers>(
    "SkinnyOptimisticOracle",
    undefined,
    5
  );
  console.log("Sending requests to SkinnyOptimisticOracle", skinnyOptimisticOracle.address);
  const ooSkinnyTx = await skinnyOptimisticOracle.requestPrice(
    approvedIdentifier,
    requestTime,
    ancillaryData,
    goerliUsdc,
    "0",
    "0",
    "7200"
  );
  ooSkinnyTx.wait();
  console.log("Sent request to SkinnyOptimisticOracle", ooSkinnyTx.hash);

  // OO v3.
  const optimisticOracleV3 = await getContractInstance<OptimisticOracleV3Ethers>("OptimisticOracleV3", undefined, 5);
  const claim = ethers.utils.formatBytes32String("The sky is blue");
  const ooV3Tx = await optimisticOracleV3.assertTruthWithDefaults(claim, (await ethers.provider.listAccounts())[0]);
  ooV3Tx.wait();
  console.log("Sent request to OptimisticOracleV3", ooV3Tx.hash);
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
