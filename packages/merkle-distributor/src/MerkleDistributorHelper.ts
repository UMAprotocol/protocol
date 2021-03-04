// This helper includes a set of useful functions when dealing with merkle trees and payout claims.
const { ethers } = require("ethers");
const { getAbi } = require("@uma/core");

import MerkleTree from "./MerkleTree";
const CloudflareKVHelper = require("../src/CloudflareKVHelper");

// keccak256(abi.encode(account, amount))
const createLeaf = (account: string, amount: string) => {
  return Buffer.from(ethers.utils.solidityKeccak256(["address", "uint256"], [account, amount]).substr(2), "hex");
};

function createMerkleDistributionProofs(
  recipientsData: { [key: string]: { amount: string; metaData: Object } },
  windowIndex: number
) {
  // Build an array of leafs for each recipient This is simply a hash of the address and recipient amount.
  const recipientLeafs = Object.keys(recipientsData).map((recipientAddress: string) =>
    createLeaf(recipientAddress, recipientsData[recipientAddress].amount)
  );

  // Build the merkle proof from the leafs.
  const merkleTree = new MerkleTree(recipientLeafs);

  // Lastly, append the leaf and generated proof for each recipient to the original data structure.
  let recipientsDataWithProof: any = {};
  Object.keys(recipientsData).forEach((recipientAddress, index) => {
    recipientsDataWithProof[recipientAddress] = {};
    recipientsDataWithProof[recipientAddress].amount = recipientsData[recipientAddress].amount;
    recipientsDataWithProof[recipientAddress].metaData = recipientsData[recipientAddress].metaData;
    recipientsDataWithProof[recipientAddress].windowIndex = windowIndex;
    recipientsDataWithProof[recipientAddress].proof = merkleTree.getHexProof(recipientLeafs[index]);
  });

  return { recipientsDataWithProof, merkleRoot: merkleTree.getHexRoot() };
}

async function getClaimsForAddress(merkleDistributorAddress: string, claimerAddress: string, chainId: number) {
  // Create a new ethers contract instance to fetch on-chain contract information.
  const infuraApiKey = process.env.INFURA_API_KEY || null;
  const ethersProvider = new ethers.providers.InfuraProvider(chainId, infuraApiKey);
  const signer = new ethers.VoidSigner(claimerAddress, ethersProvider);
  const merkleDistributorContract = new ethers.Contract(merkleDistributorAddress, getAbi("MerkleDistributor"), signer);

  // Fetch the information about a particular chainId. This will contain the window IDs, the reward token & IPFS hash
  // for all claim windows on a particular chain.
  const chainWIndowInformation = await CloudflareKVHelper.fetchChainWindowIndicesFromKV(chainId);
  if (chainWIndowInformation.error) return chainWIndowInformation;

  // Extract the windowIDs from the chain information. These are the unique identifiers for each claims window.
  const potentialClaimWindowsIds = Object.keys(chainWIndowInformation);

  // For each claimId, fetch the accounts information form cloudflare.
  const claimsProofsPromises = potentialClaimWindowsIds.map((claimWindowIndex: string) =>
    CloudflareKVHelper.fetchClaimsFromKV(chainId, Number(claimWindowIndex), claimerAddress)
  );

  // For each claimID, check if the account has already claimed it on-chain.
  const hasAccountClaimedPromises = potentialClaimWindowsIds.map((claimWindowIndex: string) =>
    merkleDistributorContract.claimed(claimWindowIndex, claimerAddress)
  );

  // Yield all claims in parallel
  const [claimsProofs, contractClaimsProofs] = await Promise.all([
    Promise.all(claimsProofsPromises),
    Promise.all(hasAccountClaimedPromises)
  ]);

  // Finally, join the cloudflare and on-chain data to return all claims for the provided account. Filter out any claims
  // that contain error. This would occur if the account was not part of a particular claim window on this chainId.
  const accountClaims = claimsProofs
    .filter((claim: any) => !claim.error)
    .map((claim: any) => {
      return {
        ...claim,
        ...chainWIndowInformation[claim.windowIndex.toString()],
        hasClaimed: contractClaimsProofs[claim.windowIndex]
      };
    });
  return accountClaims;
}

export = { createMerkleDistributionProofs, getClaimsForAddress };
