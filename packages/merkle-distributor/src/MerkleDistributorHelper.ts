// This helper includes a set of useful functions when dealing with merkle trees and payout claims.
import { ethers } from "ethers";
import { getAbi } from "@uma/core";

import MerkleTree from "./MerkleTree";
import CloudflareHelper from "./CloudflareKVHelper";

// keccak256(abi.encode(account, amount))
export function createLeaf(account: string, amount: string, accountIndex: number) {
  return Buffer.from(
    ethers.utils.solidityKeccak256(["address", "uint256", "uint256"], [account, amount, accountIndex]).substr(2),
    "hex"
  );
}

export function createMerkleDistributionProofs(
  recipientsData: { [key: string]: { amount: string; metaData: any; accountIndex: number } },
  windowIndex: number
) {
  // Build an array of leafs for each recipient This is simply a hash of the address and recipient amount.
  const recipientLeafs = Object.keys(recipientsData).map((recipientAddress: string) =>
    createLeaf(recipientAddress, recipientsData[recipientAddress].amount, recipientsData[recipientAddress].accountIndex)
  );

  // Build the merkle proof from the leafs.
  const merkleTree = new MerkleTree(recipientLeafs);

  // Lastly, append the leaf and generated proof for each recipient to the original data structure.
  const recipientsDataWithProof: any = {};
  Object.keys(recipientsData).forEach((recipientAddress, index) => {
    recipientsDataWithProof[recipientAddress] = {};
    recipientsDataWithProof[recipientAddress].accountIndex = recipientsData[recipientAddress].accountIndex;
    recipientsDataWithProof[recipientAddress].amount = recipientsData[recipientAddress].amount;
    recipientsDataWithProof[recipientAddress].metaData = recipientsData[recipientAddress].metaData;
    recipientsDataWithProof[recipientAddress].windowIndex = windowIndex;
    recipientsDataWithProof[recipientAddress].proof = merkleTree.getHexProof(recipientLeafs[index]);
  });

  return { recipientsDataWithProof, merkleRoot: merkleTree.getHexRoot() };
}

export async function getClaimsForAddress(merkleDistributorAddress: string, claimerAddress: string, chainId: number) {
  // Instantiate the cloudflare helper.
  const cfHelper = CloudflareHelper(
    process.env.CLOUDFLARE_ACCOUNT_ID,
    process.env.CLOUDFLARE_NAMESPACE_ID,
    process.env.CLOUDFLARE_TOKEN
  );

  // Create a new ethers contract instance to fetch on-chain contract information.
  const infuraApiKey = process.env.INFURA_API_KEY || null;
  const ethersProvider = new ethers.providers.InfuraProvider(chainId, infuraApiKey);
  const signer = new ethers.VoidSigner(claimerAddress, ethersProvider);
  const merkleDistributorContract = new ethers.Contract(merkleDistributorAddress, getAbi("MerkleDistributor"), signer);

  // Fetch the information about a particular chainId. This will contain the window IDs, the reward token & IPFS hash
  // for all claim windows on a particular chain.
  const chainWIndowInformation = await cfHelper.fetchChainWindowIndicesFromKV(chainId);
  if (chainWIndowInformation.error) return chainWIndowInformation;

  // Extract the windowIDs from the chain information. These are the unique identifiers for each claims window.
  const potentialClaimWindowsIds = Object.keys(chainWIndowInformation);

  // For each claimId, fetch the accounts information form cloudflare. This includes the proofs and metadata.
  const claimsProofs = await Promise.all(
    potentialClaimWindowsIds.map((claimWindowIndex: string) =>
      cfHelper.fetchClaimsFromKV(chainId, Number(claimWindowIndex), claimerAddress)
    )
  );

  // For each claimID, check if the account has already claimed it on-chain. For this, we use the claimWindowIndex and
  // the claimer accountIndex.
  const hasAccountClaimed = await Promise.all(
    potentialClaimWindowsIds.map((claimWindowIndex: any, index: number) =>
      !claimsProofs[index].errors
        ? merkleDistributorContract.isClaimed(claimWindowIndex, claimsProofs[index].accountIndex)
        : null
    )
  );

  // Finally, join the cloudflare and on-chain data to return all claims for the provided account. Filter out any claims
  // that contain error. This would occur if the account was not part of a particular claim window on this chainId.
  return claimsProofs
    .filter((claim: any) => !claim.errors)
    .map((claim: any) => {
      return {
        ...claim,
        ...chainWIndowInformation[claim.windowIndex.toString()],
        hasClaimed: hasAccountClaimed[claim.windowIndex]
      };
    });
}
