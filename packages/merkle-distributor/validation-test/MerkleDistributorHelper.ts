// These tests validate the behavior of the MerkleDistributorHelper. They are NOT meant to be run within CI as
// they require privileged information(such as cloudflare API keys) and they run against the kovan test network.
// They are simply meant to showcase the correct behavior of the helpers under a number of different situations and inputs.

const { ethers } = require("ethers");
const { assert } = require("chai");

const { createMerkleDistributionProofs, getClaimsForAddress } = require("../src/MerkleDistributorHelper.ts");

import MerkleTree from "../src/MerkleTree";

const exampleRecipients: { [key: string]: any } = {
  "0x00b591bc2b682a0b30dd72bac9406bfa13e5d3cd": {
    amount: "1000000000000000000",
    metaData: { payouts: ["YD-WETH-21 Liquidity Mining"] }
  },
  "0x00e4846e2971bb2b29cec7c9efc8fa686ae21342": {
    amount: "2000000000000000000",
    metaData: { payouts: ["YD-WETH-21 Liquidity Mining", "Governance Votes KPI Options"] }
  },
  "0x00e4f5a158ec094da8cf55f8d994b84b6f5f33d9": {
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
  "windowStart",
  "hasClaimed"
];

// Kovan information.
const validClaimerAddress1 = "0x00b591bc2b682a0b30dd72bac9406bfa13e5d3cd"; // Address that has 6 unclaimed windows.
const validClaimerAddress2 = "0x01b01c6fb158e55c83883219a533f1efd2abfdf4"; // Address that has 4 unclaimed windows and 1 claimed window.
const invalidClaimerAddress = "0x0000000000000000000000000000000000000000";
const merkleDistributorContractAddress = "0xAfCd2405298C2FABB2F7fCcEB919B4505A6bdDFC"; // Kovan deployment of the Distributor contract.
const networkId = 42;

describe("MerkleDistributorHelper.js", async function() {
  it("Can correctly generate merkle proofs including arbitrary metadata", async function() {
    const windowIndex = 0;
    const { recipientsDataWithProof, merkleRoot } = createMerkleDistributionProofs(exampleRecipients, windowIndex);

    // Each recipient should contain the correct keys which should not be undefined.
    Object.keys(recipientsDataWithProof).forEach(recipient => {
      ["metaData", "amount", "proof"].forEach(expectedKey => {
        assert(Object.keys(recipientsDataWithProof[recipient]).includes(expectedKey));
        assert(recipientsDataWithProof[recipient][expectedKey]);
      });
    });

    // The merkleRoot should match the expected value.
    const recipientLeafs = Object.keys(exampleRecipients).map((recipientAddress: string) =>
      Buffer.from(
        ethers.utils
          .solidityKeccak256(["address", "uint256"], [recipientAddress, exampleRecipients[recipientAddress].amount])
          .substr(2),
        "hex"
      )
    );
    const merkleTree = new MerkleTree(recipientLeafs);
    assert.equal(merkleTree.getHexRoot(), merkleRoot);
  });
  it("Can correctly fetch claims for a valid, included address", async function() {
    // validClaimerAddress1 has 6 claims on kovan, none of which they have claimed.
    this.timeout(10000);

    const claims = await getClaimsForAddress(merkleDistributorContractAddress, validClaimerAddress1, networkId);

    // should contain all 6 claims.
    assert.equal(claims.length, 6);

    // The returned values should all contain the expected keys
    claims.forEach((claim: any) => {
      expectedClaimsKeys.forEach(expectedKey => {
        assert.isTrue(claim[expectedKey] && Object.keys(claim).includes(expectedKey));
      });
    });
  });
  it("Can correctly deal with claimers that have claimed some rewards and are not part of all windows", async function() {
    // validClaimerAddress2 has 5 claims on kovan, 1 of which is claimed and it is missing window index 2.
    this.timeout(10000);

    const claims = await getClaimsForAddress(merkleDistributorContractAddress, validClaimerAddress2, networkId);

    // The returned values should all contain the expected keys
    claims.forEach((claim: any) => {
      expectedClaimsKeys.forEach(expectedKey => {
        console.log("claims", claim);
        console.log("expectedKeys", expectedKey);
        assert.isTrue(Object.keys(claim).includes(expectedKey));
      });
    });

    assert.equal(claims.length, 5);

    // the 3rd index should be claimed. This was done manually against this claimerAddress on Kovan.
    assert.isTrue(claims[3].hasClaimed);
  });
  it("Should correctly handel wallets that are not part of the distribution set", async function() {
    // Check that an address that has no rewards does not error out but rather just returns an empty array.
    const claims = await getClaimsForAddress(merkleDistributorContractAddress, invalidClaimerAddress, networkId);
    assert.equal(claims.length, 0);
  });
});
