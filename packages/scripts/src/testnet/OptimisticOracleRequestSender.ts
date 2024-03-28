// This script is used to help test OO interfaces on testnets by producing a set of OO requests.

import { ERC20 } from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../utils/contracts";

import {
  OptimisticOracleEthers,
  OptimisticOracleV2Ethers,
  SkinnyOptimisticOracleEthers,
  OptimisticOracleV3Ethers,
} from "@uma/contracts-node";
import { BigNumber } from "ethers";
import { toUtf8Bytes } from "ethers/lib/utils";

const hre = require("hardhat");
const { ethers } = hre;

const ancillaryData = toUtf8Bytes(`q:"Really hard question, maybe 100, maybe 90?"`);

const yesNoIdentifier = "0x5945535f4f525f4e4f5f51554552590000000000000000000000000000000000";

const asserterIdentifier = "0x4153534552545f54525554480000000000000000000000000000000000000000";

const defaultBondOrReward = "10000";

const defaultLiveness = "7200";

const sepoliaUsdc = "0x20205D46ae5299d8E99B98042ebb4B2999169d3A";

const requestTime = Math.floor(new Date().valueOf() / 1000) - 1000;

const approveIfNecessary = async (token: ERC20, spender: string, amount: BigNumber) => {
  const wallet = (await ethers.provider.listAccounts())[0];
  const allowance = await token.allowance(wallet, spender);
  if (allowance.lt(amount)) {
    const approveTx = await token.approve(spender, ethers.constants.MaxUint256);
    await approveTx.wait();
  }
};

async function main() {
  console.log("Running OptimisticOracleRequestSender script 🚀");

  const chainId = (await ethers.provider.getNetwork()).chainId;

  const collateralToken = await getContractInstance<ERC20>("ERC20", sepoliaUsdc, chainId);

  if (!chainId || chainId != 11155111) throw new Error("This script should be run on sepolia");

  // OO v1.
  const optimisticOracle = await getContractInstance<OptimisticOracleEthers>("OptimisticOracle", undefined, chainId);
  await approveIfNecessary(collateralToken, optimisticOracle.address, BigNumber.from(defaultBondOrReward));
  console.log("Sending requests to OptimisticOracle", optimisticOracle.address);
  const ooTx = await optimisticOracle.requestPrice(
    yesNoIdentifier,
    requestTime,
    ancillaryData,
    sepoliaUsdc,
    defaultBondOrReward
  );
  ooTx.wait();
  console.log("Sent request to OptimisticOracle", ooTx.hash);

  //   OO v2.
  const optimisticOracleV2 = await getContractInstance<OptimisticOracleV2Ethers>(
    "OptimisticOracleV2",
    undefined,
    chainId
  );
  await approveIfNecessary(collateralToken, optimisticOracleV2.address, BigNumber.from(defaultBondOrReward));
  console.log("Sending requests to OptimisticOracleV2", optimisticOracleV2.address);
  const ooV2Tx = await optimisticOracleV2.requestPrice(
    yesNoIdentifier,
    requestTime,
    ancillaryData,
    sepoliaUsdc,
    defaultBondOrReward
  );
  ooV2Tx.wait();
  console.log("Sent request to OptimisticOracleV2", ooV2Tx.hash);

  //   OO Skinny.
  const skinnyOptimisticOracle = await getContractInstance<SkinnyOptimisticOracleEthers>(
    "SkinnyOptimisticOracle",
    undefined,
    chainId
  );
  await approveIfNecessary(collateralToken, skinnyOptimisticOracle.address, BigNumber.from(defaultBondOrReward));
  console.log("Sending requests to SkinnyOptimisticOracle", skinnyOptimisticOracle.address);
  const ooSkinnyTx = await skinnyOptimisticOracle.requestPrice(
    yesNoIdentifier,
    requestTime,
    ancillaryData,
    sepoliaUsdc,
    defaultBondOrReward,
    defaultBondOrReward,
    defaultLiveness
  );
  ooSkinnyTx.wait();
  console.log("Sent request to SkinnyOptimisticOracle", ooSkinnyTx.hash);

  // OO v3.
  const optimisticOracleV3 = await getContractInstance<OptimisticOracleV3Ethers>(
    "OptimisticOracleV3",
    undefined,
    chainId
  );
  await approveIfNecessary(collateralToken, optimisticOracleV3.address, BigNumber.from(defaultBondOrReward));
  console.log("Sending requests to OptimisticOracleV3", optimisticOracleV3.address);
  const claim = ethers.utils.formatBytes32String("The sky is blue");
  const ooV3Tx = await optimisticOracleV3.assertTruth(
    claim,
    (await ethers.provider.listAccounts())[0],
    "0x0000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000000000000",
    defaultLiveness,
    sepoliaUsdc,
    defaultBondOrReward,
    asserterIdentifier,
    "0x0000000000000000000000000000000000000000000000000000000000000000"
  );
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
