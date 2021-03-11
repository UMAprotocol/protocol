// These tests validate the behavior of the MerkleDistributorHelper. They are NOT meant to be run within CI as
// they require privileged information(such as cloudflare API keys) and they run against the kovan test network.
// They are simply meant to showcase the correct behavior of the helpers under a number of different situations and inputs.

const { ethers } = require("ethers");
const { assert } = require("chai");

import { createLeaf, createMerkleDistributionProofs, getClaimsForAddress } from "../src/MerkleDistributorHelper";

import MerkleTree from "../src/MerkleTree";

const exampleRecipients: { [key: string]: any } = {
  "0x00b591bc2b682a0b30dd72bac9406bfa13e5d3cd": {
    accountIndex: 0,
    amount: "1000000000000000000",
    metaData: { payouts: ["YD-WETH-21 Liquidity Mining"] }
  },
  "0x00e4846e2971bb2b29cec7c9efc8fa686ae21342": {
    accountIndex: 1,
    amount: "2000000000000000000",
    metaData: { payouts: ["YD-WETH-21 Liquidity Mining", "Governance Votes KPI Options"] }
  },
  "0x00e4f5a158ec094da8cf55f8d994b84b6f5f33d9": {
    accountIndex: 2,
    amount: "3000000000000000000",
    metaData: { payouts: ["YD-WETH-21 Liquidity Mining", "Governance Votes KPI Options", "Token Minter KPI Options"] }
  }
};

const expectedClaimsKeys = [
  "amount",
  "metaData",
  "proof",
  "ipfsHash",
  "rewardToken",
  "totalRewardDistributed",
  "hasClaimed"
];

// Kovan information.
const validClaimerAddress1 = "0x00b591bc2b682a0b30dd72bac9406bfa13e5d3cd"; // Address that has 4 unclaimed windows.
const validClaimerAddress2 = "0x01b01c6fb158e55c83883219a533f1efd2abfdf4"; // Address that has 2 unclaimed window and 1 claimed window.
const invalidClaimerAddress = "0x0000000000000000000000000000000000000000";
const merkleDistributorContractAddress = "0xda6489670eb1bc19302aad841eb131358bcf886a"; // Kovan deployment of the Distributor contract.
const networkId = 42;

describe("MerkleDistributorHelper.js", async function() {
  it("Can correctly generate merkle proofs including arbitrary metadata", async function() {
    const windowIndex = 0;
    const { recipientsDataWithProof, merkleRoot } = createMerkleDistributionProofs(exampleRecipients, windowIndex);

    // Each recipient should contain the correct keys which should not be undefined.
    Object.keys(recipientsDataWithProof).forEach(recipient => {
      ["accountIndex", "metaData", "amount", "proof"].forEach(expectedKey => {
        assert(Object.keys(recipientsDataWithProof[recipient]).includes(expectedKey));
        assert(recipientsDataWithProof[recipient][expectedKey] != null);
      });
    });

    // The merkleRoot should match the expected value.
    const recipientLeafs = Object.keys(exampleRecipients).map((recipientAddress: string) =>
      createLeaf(
        recipientAddress,
        exampleRecipients[recipientAddress].amount,
        exampleRecipients[recipientAddress].accountIndex
      )
    );
    const merkleTree = new MerkleTree(recipientLeafs);
    assert.equal(merkleTree.getHexRoot(), merkleRoot);
  });
  it("Can correctly fetch claims for a valid, included address", async function() {
    // validClaimerAddress1 has 4 claims on kovan, none of which they have claimed.
    this.timeout(10000);

    const claims = await getClaimsForAddress(merkleDistributorContractAddress, validClaimerAddress1, networkId);

    // should contain all 4 claims.
    assert.equal(claims.length, 4);

    // The returned values should all contain the expected keys
    claims.forEach((claim: any) => {
      expectedClaimsKeys.forEach(expectedKey => {
        assert.isTrue(claim[expectedKey] != null && Object.keys(claim).includes(expectedKey));
      });
    });
  });
  it("Can correctly deal with claimers that have claimed some rewards and are not part of all windows", async function() {
    // validClaimerAddress2 has 2 claims on kovan, 1 of which is claimed and 1 which is not yet claimed. They are missing
    // from the second index.
    this.timeout(10000);

    const claims = await getClaimsForAddress(merkleDistributorContractAddress, validClaimerAddress2, networkId);

    // The returned values should all contain the expected keys
    claims.forEach((claim: any) => {
      expectedClaimsKeys.forEach(expectedKey => {
        assert.isTrue(Object.keys(claim).includes(expectedKey));
      });
    });
    assert.equal(claims.length, 3);

    // the 2rd index should be claimed. This was done manually against this claimerAddress on Kovan.
    assert.isTrue(claims[2].hasClaimed);
  });
  it("Should correctly handel wallets that are not part of the distribution set", async function() {
    // Check that an address that has no rewards does not error out but rather just returns an empty array.
    const claims = await getClaimsForAddress(merkleDistributorContractAddress, invalidClaimerAddress, networkId);
    assert.equal(claims.length, 0);
  });
});
