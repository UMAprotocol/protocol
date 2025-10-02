# Deprecate Lock Contracts

This directory contains scripts to deprecate 5 lock contracts on Ethereum mainnet by setting their lock window to 0 and renouncing ownership. The scripts generate a Safe Multisig transaction payload that can be imported into the Gnosis Safe Transaction Builder UI.

## Overview

The script will generate a JSON payload containing 10 transactions (2 per contract):

1. `setLockWindow(0)` - Sets the lock window to zero
2. `transferOwnership(0x0000000000000000000000000000000000000000)` - Renounces ownership

Target contracts:

- 0xc47641ed51f73A82C62Ba439d90096bccC376fe8
- 0xCf17f459F4D1D9e6fb5aa5013Bd2D7EB6083bd45
- 0x4fC22E5f89891B6bd00d554B6250503d38EE5E4D
- 0xE2380c199F07e78012c6D0b076A4137E6D1Ba022
- 0x171b10e16223F86500D558D426Bf4fa5EF280087

## Prerequisites

Build the packages from the root of the repository:

```sh
yarn && yarn build
```

## Testing on Forked Network

### 1. Spin up a forked mainnet node

In a separate terminal:

```sh
HARDHAT_CHAIN_ID=1 yarn hardhat node --fork <YOUR-MAINNET-RPC-URL> --port 8545 --no-deploy
```

### 2. Export required environment variables

```sh
export SAFE_ADDRESS=<YOUR-SAFE-MULTISIG-ADDRESS>
export NODE_URL_1=http://localhost:8545
```

Note: The `SAFE_ADDRESS` should be the Gnosis Safe multisig that owns these contracts.

### 3. Generate and simulate the payload

```sh
yarn hardhat run packages/scripts/src/admin-proposals/deprecate-oval-contracts/0_GeneratePayload.ts --network localhost
```

This will:

- Generate the JSON payload file at `packages/scripts/out/deprecate-oval-contracts_1.json`
- Simulate the execution on the forked network by impersonating the Safe owners
- Execute all 10 transactions atomically through the Safe

### 4. Verify the changes

```sh
yarn hardhat run packages/scripts/src/admin-proposals/deprecate-oval-contracts/1_Verify.ts --network localhost
```

This will verify that:

- All 5 contracts have `lockWindow` set to 0
- All 5 contracts have ownership renounced (owner is 0x0)

## Production Use on Mainnet

### 1. Export required environment variables

```sh
export SAFE_ADDRESS=<YOUR-SAFE-MULTISIG-ADDRESS>
export NODE_URL_1=<YOUR-MAINNET-RPC-URL>
```

### 2. Generate the payload

```sh
yarn hardhat run packages/scripts/src/admin-proposals/deprecate-oval-contracts/0_GeneratePayload.ts --network mainnet
```

This will generate `packages/scripts/out/deprecate-oval-contracts_1.json`

### 3. Import into Gnosis Safe Transaction Builder

1. Navigate to your Safe at https://app.safe.global/
2. Go to "Transaction Builder" in the left sidebar
3. Click "Create Batch"
4. Click "Upload a JSON file"
5. Select the generated `deprecate-oval-contracts_1.json` file
6. Review the 10 transactions:
   - 5 × `setLockWindow(0)` calls
   - 5 × `transferOwnership(0x0000000000000000000000000000000000000000)` calls
7. Create the batch transaction
8. Sign and execute with required Safe signers

### 4. Verify on mainnet

After the Safe transaction is executed:

```sh
yarn hardhat run packages/scripts/src/admin-proposals/deprecate-oval-contracts/1_Verify.ts --network mainnet
```

This will confirm all contracts have been successfully deprecated.
