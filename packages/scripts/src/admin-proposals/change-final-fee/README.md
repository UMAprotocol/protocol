## Change Final Fee Proposal Scripts

This README file will guide you on how to run the scripts to propose and verify changes to the final fee for WETH and stable coin tokens collateral types in the mainnet and in supported L2 chains.

## 1. Propose Fee Changes

This script creates a proposal to change the final fee for the WETH and stable coin tokens collateral types in mainnet and in the supported L2 chains.

To run the proposal script:

1.  Fork mainnet into a local hardhat node by running:

    `HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy`

2.  Run setup fork script from the root of the repo:

    `./packages/scripts/setupFork.sh`

3.  Execute the proposal script with the new fee values and node URLs:

```
    NEW_FINAL_FEE_USD=<NEW_FINAL_FEE_USD> \
    NEW_FINAL_FEE_WETH=<NEW_FINAL_FEE_WETH> \
    UMIP_NUMBER=<UMIP_NUMBER> \
    NODE_URL_1=<MAINNET-NODE-URL> \
    NODE_URL_10=<OPTIMISM-NODE-URL> \
    NODE_URL_137=<POLYGON-NODE-URL> \
    NODE_URL_42161=<ARBITRUM-NODE-URL> \
    yarn hardhat run ./src/admin-proposals/change-final-fee/0_Propose.ts --network localhost
```

4. Run the simulate vote script

   `yarn hardhat run ./src/admin-proposals/simulateVoteV2.ts --network localhost`

## 2. Verify Mainnet Fee Changes

This script verifies that the new final fee has been correctly configured in the mainnet.

To run the verification script on a local hardhat node fork of the mainnet or directly on the mainnet:

Execute the verification script with the new fee values and node URL:

```
    NEW_FINAL_FEE_USD=<NEW_FINAL_FEE_USD> \
    NEW_FINAL_FEE_WETH=<NEW_FINAL_FEE_WETH> \
    NODE_URL_1=<MAINNET-NODE-URL> \
    PROPOSAL_DATA=<PROPOSAL_DATA> \
    yarn hardhat run ./src/admin-proposals/change-final-fee/1_Verify.ts --network localhost
```

## 3. Verify L2 Chains Fee Changes

This script verifies that the new final fee has been correctly configured in the L2 chains. It can be run on forks directly on the mainnets to verify.

To run the script:

```
    FORK_NETWORK=true \
    NEW_FINAL_FEE_USD=<NEW_FINAL_FEE_USD> \
    NEW_FINAL_FEE_WETH=<NEW_FINAL_FEE_WETH> \
    NODE_URL_10=<OPTIMISM-NODE-URL> \
    NODE_URL_137=<POLYGON-NODE-URL> \
    NODE_URL_42161=<ARBITRUM-NODE-URL> \
    PROPOSAL_DATA=<PROPOSAL_DATA> \
    yarn hardhat run ./src/admin-proposals/change-final-fee/2_VerifyRelays.ts
```

Replace the placeholders (e.g., `<NEW_FINAL_FEE_USD>`) with the appropriate values when executing the commands.
