// This script adds some useful functions for dealing with IPFS.

const ipfsApi = require("ipfs-http-client"); // using require import as the types on this package are broken in TS.
import nodeFetch from "node-fetch";

export default (pinataApiKey: string | undefined, pinataApiSecret: string | undefined) => {
  const ipfs = ipfsApi({ host: "ipfs.infura.io", port: 5001, protocol: "https" });

  async function uploadFile(file: any) {
    const { path } = await ipfs.add({ content: Buffer.from(JSON.stringify(file)) });
    return path;
  }

  async function viewFile(fileHash: string) {
    const response = await nodeFetch(`"https://ipfs.infura.io:5001/api/v0/get?arg=${fileHash}`);
    return await response.json();
  }

  async function pinHash(hashToPin: string) {
    const infuraResponse = await nodeFetch(`https://ipfs.infura.io:5001/api/v0/pin/add?arg=${hashToPin}`);
    if (infuraResponse.status != 200) throw { infuraResponse, error: new Error("Failed to pin on infura") };

    if (pinataApiKey && pinataApiSecret) {
      const pinataResponse = await nodeFetch(`https://api.pinata.cloud/pinning/pinByHash`, {
        method: "post",
        body: JSON.stringify({ hashToPin }),
        headers: {
          "Content-Type": "application/json",
          pinata_api_key: pinataApiKey,
          pinata_secret_api_key: pinataApiSecret
        }
      });
      if (pinataResponse.status != 200) throw { pinataResponse, error: new Error("Failed to pin on pinata") };
    }
  }
  return { uploadFile, viewFile, pinHash };
};
