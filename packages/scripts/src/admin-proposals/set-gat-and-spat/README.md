### Admin Proposal Script: Update GAT and SPAT

These scripts allow you to submit and verify an on-chain admin proposal to update the **GAT** (Global Approval Threshold) and **SPAT** (Settlement Price Approval Threshold) in the `VotingV2` contract via `ProposerV2`.

### Setup

**Console 1** — Start a local Hardhat node forked from mainnet:

```bash
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<INFURA_KEY> --port 9545 --no-deploy
```

**Console 2** — Set up the forked environment:

```bash
./packages/scripts/setupFork.sh
```

---

### Run Proposal Script

Submit the proposal to `ProposerV2`:

```bash
NODE_URL_1="http://localhost:9545/" \
UMIP=<UMIP> \ # e.g. 186
GAT=<GAT> \ # e.g. 5000000
SPAT=<SPAT> \ # e.g. 65
yarn hardhat run packages/scripts/src/admin-proposals/set-gat-and-spat/0_Propose.ts --network localhost
```

- `GAT`: Number of tokens required (not scaled by decimals)
- `SPAT`: Percentage (e.g. `65` for 65%)
- `UMIP`: Reference UMIP number for the proposal metadata

---

### Simulate a Vote

Run this to simulate vote resolution and finalize the proposal:

```bash
yarn hardhat run packages/scripts/src/admin-proposals/simulateVoteV2.ts --network localhost
```

---

### Run Verification Script

Check that the new GAT and SPAT values are correctly set on-chain:

```bash
NODE_URL_1="http://localhost:9545/" \
GAT=<GAT> \ # e.g. 5000000
SPAT=<SPAT> \ # e.g. 65
yarn hardhat run packages/scripts/src/admin-proposals/set-gat-and-spat/1_Verify.ts --network localhost
```

---
