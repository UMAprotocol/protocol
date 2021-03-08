// This file contains some helper functions to wrap cloudflare Key Value store.

const nodeFetch = require("node-fetch");

if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_NAMESPACE_ID || !process.env.CLOUDFLARE_TOKEN) {
  throw new Error(
    "Missing Cloudflare environment variables! CLOUDFLARE_ACCOUNT_ID,CLOUDFLARE_NAMESPACE_ID and CLOUDFLARE_TOKEN must be provided"
  );
}
const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CLOUDFLARE_NAMESPACE_ID}`;
const AUTHENTICATED_HEADER = {
  Authorization: `Bearer ${process.env.CLOUDFLARE_TOKEN}`,
  "Content-Type": "application/json"
};

// Bulk add to Cloudflare KV. Data should be a stringified array of [{key:<your-key>,value:<your-value>}]
async function _addDataToKV(data: string) {
  const response = await nodeFetch(`${BASE_URL}/bulk`, { method: "put", body: data, headers: AUTHENTICATED_HEADER });
  if (response.status != 200) throw { response, error: new Error("Something went wrong adding data to KV") };
  const jsonResponse = await response.json();
  return jsonResponse;
}

// Fetched the data stored at a particular key from cloudflare. Throws on error. Errors include key not found.
async function _fetchDataFromKV(key: string) {
  const response = await nodeFetch(`${BASE_URL}/values/${key}`, { method: "get", headers: AUTHENTICATED_HEADER });
  if (response.status != 200) throw { response, error: new Error("Something went wrong fetching data from KV") };
  return await response.json();
}

// Takes recipient proof information and adds it to CloudflareKV. Each recipient's information is stored as chainId:windowIndex:account as the key & the value as stringified object of amount, windowIndex, metatadata and proof.
async function addClaimsToKV(
  recipientsData: { [key: string]: { amount: string; windowIndex: number; metaData: any; proof: Array<string> } },
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

  const BATCH_SIZE = 10_000; // limit how many we add in each bulk upload. Cloud flare limits 10k per bulk put.
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
  totalRewardDistributed: string,
  windowStart: number
) {
  let newChainIndices: {
    [key: number]: { ipfsHash: string; rewardToken: string; totalRewardDistributed: string; windowStart: number };
  } = {};

  const currentChainIndices = await fetchChainWindowIndicesFromKV(chainId);
  if (currentChainIndices) {
    newChainIndices = currentChainIndices;
    newChainIndices[windowIndex] = { ipfsHash, rewardToken, totalRewardDistributed, windowStart };
  } else {
    // If the above errors out it's due to the chainId not yet containing any ipfsHashes. We can simply add one.
    newChainIndices[windowIndex] = { ipfsHash, rewardToken, totalRewardDistributed, windowStart };
  }
  // Finally, add the data cloudflare.
  await _addDataToKV(JSON.stringify([{ key: `${chainId}`, value: JSON.stringify(newChainIndices) }]));
}

async function fetchClaimsFromKV(chainId: number, windowIndex: number, account: string) {
  try {
    return await _fetchDataFromKV(`${chainId}:${windowIndex}:${account}`);
  } catch (error) {
    return error;
  }
}
async function fetchChainWindowIndicesFromKV(chainId: number) {
  try {
    return await _fetchDataFromKV(`${chainId}`);
  } catch (error) {
    return error;
  }
}

export = { addClaimsToKV, fetchClaimsFromKV, fetchChainWindowIndicesFromKV, updateChainWindowIndicesFromKV };
