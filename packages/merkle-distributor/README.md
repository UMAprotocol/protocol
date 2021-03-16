# @uma/merkle-distributor

This package contains a number of scripts and helper functions for dealing with merkle token distribution.

## Installing the package

```bash
yarn add @uma/merkle-distributor
```

## Generating merkle proofs

There are two main scripts that need to be run in turn to build the merkle proofs and add the root on-chain.

First, ingest the payout information and recipients to build the merkle proofs by running:

```bash
ts-node ./scripts/1_CreateClaimsForWindow.ts -input ./scripts/example.json
```

To see the expected structure of this file see `example.json` within `scripts`. This script will add a file to the `proof-files` directory that contains amended information, including the merkle root and proofs for each recipient.

Next, this file is injected by the second script which will pin the claims to IPFS, upload to cloudflare KV and add the root of the merkle tree to the distributor smart contract. Note the following requirements before running the second script:

1. the unlocked account running the script is the owner of the merkleDistributor OR an account with permissions to set merkle roots.
2. the account running the script has sufficient rewards tokens to seed the merkleDistributor.
3. you have set the CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_NAMESPACE_ID and CLOUDFLARE_TOKEN env variables.
4. (optional) you have set the PINATA_SECRET_API_KEY and PINATA_API_KEY environment variables.

Once you have met these criteria you can upload your merkle proof information by running the following:

```bash
ts-node ./scripts/2_PublishClaimsForWindow.ts -input ./proof-files/chain-id-42-reward-window-0-claims-file.json --merkleDistributorAddress 0xAfCd2405298C2FABB2F7fCcEB919B4505A6bdDFC --network kovan_mnemonic
```

## Using the merkle helpers

The main helper script is `MerkleDistributorHelper.ts`. This script provides two main methods that can be consumed when working with merkle proofs.

1. `createMerkleDistributionProofs(recipientsData, windowIndex: number)` takes in an object mapped between recipient address, amount and metaData and returns the provided data with appended merkle proof and the merkleRoot of the merkle tree.
2. `getClaimsForAddress(merkleDistributorAddress, claimerAddress, chainId)` takes in the address of the merkleDistributor, a claimerAddress and a chainID and returns a data structure containing all information for the claimer on the provided chainId, including the merkkleproofs, if the rewards has been claimed and additional information about the each claim window such as the IPFS hash for the claims file. This helper will require the associate Cloudflare environment variables.

Note that these methods are designed to run in node exclusively and will not run in the browser. To access the `getClaimsForAddress` in the browser, it is recommended to wrap this method in a serverless function, such as [Vercel](https://vercel.com/docs/serverless-functions/introduction). This will protect your cloudflare API keys and enable some ingress verification.
