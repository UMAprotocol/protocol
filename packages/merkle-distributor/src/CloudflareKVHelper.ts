// This file contains some helper functions to wrap cloudflare Key Value store.

import nodeFetch from "node-fetch";
import assert from "assert";

export default (accountId: string | undefined, namespaceId: string | undefined, token: string | undefined) => {
  assert(accountId, "Cloudflare helper requires an Account ID");
  assert(namespaceId, "Cloudflare helper requires a data store namespace");
  assert(token, "Cloudflare helper requires an Account token");

  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const authenticatedHeader = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Bulk add to Cloudflare KV. Data should be a stringified array of [{key:<your-key>,value:<your-value>}]
  async function _addDataToKV(data: string) {
    const response = await nodeFetch(`${baseUrl}/bulk`, { method: "put", body: data, headers: authenticatedHeader });
    const jsonResponse = await response.json();
    return jsonResponse;
  }

  // Fetched the data stored at a particular key from cloudflare. Throws on error. Errors include key not found.
  async function _fetchDataFromKV(key: string) {
    const response = await nodeFetch(`${baseUrl}/values/${key}`, { method: "get", headers: authenticatedHeader });
    return await response.json();
  }

  // Takes recipient proof information and adds it to CloudflareKV. Each recipient's information is stored as chainId:windowIndex:account as the key & the value as stringified object of amount, windowIndex, metatadata and proof.
  async function addClaimsToKV(
    recipientsData: {
      [key: string]: { accountIndex: number; amount: string; windowIndex: number; metaData: any; proof: Array<string> };
    },
    chainId: number,
    windowIndex: number
  ) {
    const KV = Object.keys(recipientsData).map(account => {
      const claim = recipientsData[account];
      return {
        key: `${chainId}:${windowIndex}:${account}`,
        value: JSON.stringify(claim)
      };
    });

    const BATCH_SIZE = 10_000; // limit how many key-value pairs can be added in each bulk upload. Cloud flare limits 10k per bulk put.
    let i = 0;
    while (i < KV.length) {
      await _addDataToKV(JSON.stringify(KV.slice(i, (i += BATCH_SIZE))));
    }
  }

  // Append new chainIdWindow information to KV.
  async function updateChainWindowIndicesFromKV(
    chainId: number,
    windowIndex: number,
    ipfsHash: string,
    rewardToken: string,
    totalRewardDistributed: string
  ) {
    let newChainIndices: {
      [key: number]: { ipfsHash: string; rewardToken: string; totalRewardDistributed: string };
    } = {};

    const currentChainIndices = await fetchChainWindowIndicesFromKV(chainId);
    if (currentChainIndices) {
      newChainIndices = currentChainIndices;
      newChainIndices[windowIndex] = { ipfsHash, rewardToken, totalRewardDistributed };
    } else {
      // If the above errors out it's due to the chainId not yet containing any ipfsHashes. We can simply add one.
      newChainIndices[windowIndex] = { ipfsHash, rewardToken, totalRewardDistributed };
    }
    // Finally, add the data cloudflare.
    await _addDataToKV(JSON.stringify([{ key: `${chainId}`, value: JSON.stringify(newChainIndices) }]));
  }

  async function fetchClaimsFromKV(chainId: number, windowIndex: number, account: string) {
    return await _fetchDataFromKV(`${chainId}:${windowIndex}:${account}`);
  }
  async function fetchChainWindowIndicesFromKV(chainId: number) {
    return await _fetchDataFromKV(`${chainId}`);
  }

  return { addClaimsToKV, fetchClaimsFromKV, fetchChainWindowIndicesFromKV, updateChainWindowIndicesFromKV };
};
