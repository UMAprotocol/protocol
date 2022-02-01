import dotenv from "dotenv";
import { Client, Provider, PoolEventState } from "./bridgePool";
import { bridgePool } from "../../clients";
import { ethers, BigNumber } from "ethers";
import { TransactionReceipt } from "@ethersproject/abstract-provider";
import assert from "assert";
import set from "lodash/set";
import get from "lodash/get";

dotenv.config();

const multicall2Address = "0x5BA1e12693Dc8F9c48aAD8770482f4739bEeD696";
const wethAddress = "0x7355Efc63Ae731f584380a9838292c7046c1e433";
const badgerAddress = "0x43298F9f91a4545dF64748e78a2c777c580573d6";
const wbtcAddress = "0x02fbb64517E1c6ED69a6FAa3ABf37Db0482f1152";
const users = [
  "0x06d8aeb52f99f8542429df3009ed26535c22d5aa",
  "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D",
  "0x718648C8c531F91b528A7757dD2bE813c3940608",
];
const txReceipt = {
  to: "0x7355Efc63Ae731f584380a9838292c7046c1e433",
  from: "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D",
  contractAddress: wethAddress,
  transactionIndex: 72,
  gasUsed: BigNumber.from(0x012ff7),
  logsBloom:
    "0x00000000000000000000000000000000000001000000000000400000000000000080000000000000000000000000000002000000080000000000000000000000000000000000000000000008000000000000000000000000000000008000000000000100020000000000000000000800000000000000000000000010040000000000000000000000000000000000000000000001400000000000000000000000000000000000400010002000000000000000000000000000000000000000000000000002000000800000000000000000000000000000000000000000000020000001200000000000000000000004000000000000000000400000000000000000",
  blockHash: "0xbd44b43968158b0cd9e78e3aa94d8ed3a0ec662a7156246243fb6dbea753b9a6",
  transactionHash: "0x66a6f16a0fe8850780f45f463108b58ccaa7397d07c72f0df4d7790f84944163",
  logs: [
    {
      transactionIndex: 72,
      blockNumber: 13553849,
      transactionHash: "0x66a6f16a0fe8850780f45f463108b58ccaa7397d07c72f0df4d7790f84944163",
      address: "0x7355Efc63Ae731f584380a9838292c7046c1e433",
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        "0x0000000000000000000000009a8f92a830a5cb89a3816e3d267cb7791c16b04d",
      ],
      data: "0x000000000000000000000000000000000000000000000000016345703e6d5469",
      logIndex: 137,
      blockHash: "0xbd44b43968158b0cd9e78e3aa94d8ed3a0ec662a7156246243fb6dbea753b9a6",
    },
    {
      transactionIndex: 72,
      blockNumber: 13553849,
      transactionHash: "0x66a6f16a0fe8850780f45f463108b58ccaa7397d07c72f0df4d7790f84944163",
      address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      topics: [
        "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c",
        "0x0000000000000000000000007355efc63ae731f584380a9838292c7046c1e433",
      ],
      data: "0x000000000000000000000000000000000000000000000000016345785d8a0000",
      logIndex: 138,
      blockHash: "0xbd44b43968158b0cd9e78e3aa94d8ed3a0ec662a7156246243fb6dbea753b9a6",
    },
    {
      transactionIndex: 72,
      blockNumber: 13553849,
      transactionHash: "0x66a6f16a0fe8850780f45f463108b58ccaa7397d07c72f0df4d7790f84944163",
      address: "0x7355Efc63Ae731f584380a9838292c7046c1e433",
      topics: [
        "0x0351f600ef1e31e5e13b4dc27bff4cbde3e9269f0ffc666629ae6cac573eb220",
        "0x0000000000000000000000009a8f92a830a5cb89a3816e3d267cb7791c16b04d",
      ],
      data:
        "0x000000000000000000000000000000000000000000000000016345785d8a0000000000000000000000000000000000000000000000000000016345703e6d5469",
      logIndex: 139,
      blockHash: "0xbd44b43968158b0cd9e78e3aa94d8ed3a0ec662a7156246243fb6dbea753b9a6",
    },
    {
      transactionIndex: 72,
      blockNumber: 13553849,
      transactionHash: "0x66a6f16a0fe8850780f45f463108b58ccaa7397d07c72f0df4d7790f84944163",
      address: "0x7355Efc63Ae731f584380a9838292c7046c1e433",
      topics: [
        "0x0351f600ef1e31e5e13b4dc27bff4cbde3e9269f0ffc666629ae6cac573eb220",
        "0x0000000000000000000000009a8f92a830a5cb89a3816e3d267cb7791c16b04d",
      ],
      data:
        "0x000000000000000000000000000000000000000000000000016345785d8a0000000000000000000000000000000000000000000000000000016345703e6d5469",
      logIndex: 139,
      blockHash: "0xbd44b43968158b0cd9e78e3aa94d8ed3a0ec662a7156246243fb6dbea753b9a6",
    },
  ],
  blockNumber: 13553849,
  confirmations: 2,
  cumulativeGasUsed: BigNumber.from(0x5045e6),
  effectiveGasPrice: BigNumber.from(0x298907d137),
  status: 1,
  type: 2,
  byzantium: true,
};
describe("PoolEventState", function () {
  let provider: Provider;
  let client: PoolEventState;
  beforeAll(async () => {
    provider = ethers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    const instance = bridgePool.connect(wethAddress, provider);
    client = new PoolEventState(instance, 13496023);
  });
  test("read events", async function () {
    const result = await client.read(13496024);
    const nodupe = await client.read(13496025);
    assert.deepEqual(result, nodupe);
  });
  test("readTxReceipt", function () {
    const result = client.readTxReceipt(txReceipt as TransactionReceipt);
    const nodupe = client.readTxReceipt(txReceipt as TransactionReceipt);
    assert.deepEqual(result, nodupe);
  });
});
describe("Client", function () {
  const state = {};
  let provider: Provider;
  let client: Client;
  beforeAll(async () => {
    provider = ethers.getDefaultProvider(process.env.CUSTOM_NODE_URL);
    client = new Client({ multicall2Address }, { provider }, (path, data) => set(state, path, data));
  });
  test("read users", async function () {
    for (const userAddress of users) {
      await client.updateUser(userAddress, wethAddress);
      const user = get(state, ["users", userAddress, wethAddress]);
      const pool = get(state, ["pools", wethAddress]);
      assert.ok(pool);
      assert.ok(user);
    }
  });
  test("read weth pool", async function () {
    await client.updatePool(wethAddress);
    const result = get(state, ["pools", wethAddress]);
    assert.ok(result);
  });
  test("read badger pool", async function () {
    await client.updatePool(badgerAddress);
    const result = get(state, ["pools", badgerAddress]);
    assert.ok(result);
  });
  test("read wbtc pool", async function () {
    await client.updatePool(wbtcAddress);
    const result = get(state, ["pools", wbtcAddress]);
    assert.ok(result);
  });
});
