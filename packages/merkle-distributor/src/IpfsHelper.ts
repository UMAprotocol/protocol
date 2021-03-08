// This script adds some useful functions for dealing with IPFS.

const ipfsApi = require("ipfs-http-client");
const nodeFetch = require("node-fetch");

const ipfs = ipfsApi({ host: "ipfs.infura.io", port: "5001", protocol: "https" });

export async function uploadFile(file: any) {
  const { path } = await ipfs.add({ content: Buffer.from(JSON.stringify(file)) });
  return path;
}

export async function viewFile(fileHash: string) {
  try {
    const response = await nodeFetch(`"https://ipfs.infura.io:5001/api/v0/get?arg=${fileHash}`);
    const json = await response.json();
    return json;
  } catch (error) {
    throw {
      message: "Something went wrong fetching your file! It might not be json formatted on IPFS",
      error: new Error(error)
    };
  }
}

export async function pinHash(hashToPin: string) {
  const infuraResponse = await nodeFetch(`https://ipfs.infura.io:5001/api/v0/pin/add?arg=${hashToPin}`);
  if (infuraResponse.status != 200) throw { message: "Failed to pin on infura", error: new Error(infuraResponse) };

  if (process.env.PINATA_API_KEY && process.env.PINATA_SECRET_API_KEY) {
    const pinataResponse = await nodeFetch(`https://api.pinata.cloud/pinning/pinByHash`, {
      method: "post",
      body: JSON.stringify({ hashToPin }),
      headers: {
        "Content-Type": "application/json",
        pinata_api_key: process.env.PINATA_API_KEY,
        pinata_secret_api_key: process.env.PINATA_SECRET_API_KEY
      }
    });
    if (pinataResponse.status != 200) throw { message: "Failed to pin on pinata", error: new Error(pinataResponse) };
  }
}
