const hre = require("hardhat");
import nodeFetch from "node-fetch";
const { ethers } = hre;

export const increaseEvmTime = async (time: number): Promise<void> => {
  await ethers.provider.send("evm_increaseTime", [time]);
  await ethers.provider.send("evm_mine", []);
};

export const takeSnapshot = async (): Promise<string> => {
  const snapshot = await ethers.provider.send("evm_snapshot", []);
  return snapshot;
};

export const revertToSnapshot = async (snapshotId: string): Promise<void> => {
  await ethers.provider.send("evm_revert", [snapshotId]);
};

export const forkNetwork = (jsonRpcUrl: string, blockNumber?: string): Promise<void> => {
  return hre.network.provider.request({
    method: "hardhat_reset",
    params: [{ forking: { jsonRpcUrl, blockNumber } }],
  });
};

export const getForkChainId = async (jsonRpcUrl: string): Promise<number> => {
  const data = JSON.stringify({
    method: "eth_chainId",
    params: [],
    id: 1,
    jsonrpc: "2.0",
  });

  const response = await nodeFetch(jsonRpcUrl, {
    method: "POST",
    body: data,
    headers: { "Content-type": "application/json", Accept: "application/json", "Accept-Charset": "utf-8" },
  });

  const json = await response.json();

  return parseInt(json.result);
};
