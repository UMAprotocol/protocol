# Unified Oracle Settlement Bot Usage Guide

This guide demonstrates how to use the new unified Optimistic Oracle settlement bot that supports OptimisticOracle V1, SkinnyOptimisticOracle, and OptimisticOracle V2.

## Environment Variables

The bot now requires two additional environment variables to specify which Oracle type and address to monitor:

```bash
# Required: Oracle contract address to monitor
ORACLE_ADDRESS=0x...

# Required: Oracle type (OptimisticOracle, SkinnyOptimisticOracle, or OptimisticOracleV2)
ORACLE_TYPE=OptimisticOracleV2

# Existing variables (unchanged)
SETTLEMENTS_ENABLED=true
CHAIN_ID=1
POLLING_DELAY=60
# ... other environment variables
```

## Oracle Type Configuration

### OptimisticOracle V2 (Current Standard)

```bash
ORACLE_TYPE=OptimisticOracleV2
ORACLE_ADDRESS=0xA0Ae6609447e57a42c51B50EAe921D701823FFAe  # Mainnet OOv2
```

### SkinnyOptimisticOracle

```bash
ORACLE_TYPE=SkinnyOptimisticOracle
ORACLE_ADDRESS=0xeE3Afe347D5C74317041E2618C49534dAf887c24  # Mainnet Skinny OO
```

### OptimisticOracle V1 (Deprecated)

```bash
ORACLE_TYPE=OptimisticOracle
ORACLE_ADDRESS=0xc43767f4592df265b4a9f1a398b97ff24f38c6a6  # Mainnet OOv1
```

## Running the Bot

```bash
# Install dependencies
npm install

# Set environment variables
export ORACLE_TYPE=OptimisticOracleV2
export ORACLE_ADDRESS=0xA0Ae6609447e57a42c51B50EAe921D701823FFAe
export SETTLEMENTS_ENABLED=true
export CHAIN_ID=1

# Run the bot
npm run bot-oo-v2
```

## Network Deployments

### Mainnet (Chain ID: 1)

- OptimisticOracle: `0xc43767f4592df265b4a9f1a398b97ff24f38c6a6`
- SkinnyOptimisticOracle: `0xeE3Afe347D5C74317041E2618C49534dAf887c24`
- OptimisticOracleV2: `0xA0Ae6609447e57a42c51B50EAe921D701823FFAe`

### Polygon (Chain ID: 137)

- OptimisticOracle: `0xBb1A8db2D4350976a11cdfA60A1d43f97710Da49`
- OptimisticOracleV2: `0x5953f2538F613E05bA54C8a04618360bf0EeE944`

### Arbitrum (Chain ID: 42161)

- OptimisticOracle: `0x031A7882cE3e8b4462b057EBb0c3F23Cd731D234`
- OptimisticOracleV2: `0xa6147867264374F324524E30C02C331cF28aa879`

## Architecture Overview

The unified bot uses a dispatcher pattern:

```
settleRequests()
├── OptimisticOracle → settleOOv1Requests()
├── SkinnyOptimisticOracle → settleSkinnyOORequests()
└── OptimisticOracleV2 → settleOOv2Requests()
```

Each Oracle type has its own specialized settlement logic to handle the differences in:

- Contract interfaces
- Function signatures
- Event structures
- Request parameter requirements

## Key Differences by Oracle Type

### OptimisticOracle V1

- Simple settlement: `settle(requester, identifier, timestamp, ancillaryData)`
- Basic event structure
- Deprecated but still deployed on many networks

### SkinnyOptimisticOracle

- Complex settlement: `settle(requester, identifier, timestamp, ancillaryData, request)`
- Requires reconstructing request parameters
- More gas-efficient design
- 32-bit timestamps instead of 256-bit

### OptimisticOracle V2

- Enhanced settlement: `settle(requester, identifier, timestamp, ancillaryData)`
- Rich event data and callbacks
- Current standard implementation
- Full 256-bit timestamp support

## Monitoring and Logging

The bot provides detailed logging for each Oracle type:

```
INFO  OracleBot - Optimistic Oracle Bot started 🤖
      oracleType: "OptimisticOracleV2"
      oracleAddress: "0xA0Ae6609447e57a42c51B50EAe921D701823FFAe"

DEBUG OOv2Bot - Request is settleable
      requestKey: "0x..."
      requester: "0x..."

WARN  OOv2Bot - Price Request Settled ✅
      resolvedPrice: "1000000000000000000"
```

## Error Handling

The bot gracefully handles errors specific to each Oracle type:

- Invalid contract addresses
- Unsupported Oracle types
- Gas estimation failures
- Transaction reverts
- Network connectivity issues

## Testing

Tests are provided for all three Oracle types:

- `test/OptimisticOracleV2Bot.ts` - OOv2 integration tests
- `test/OptimisticOracleV1Bot.ts` - OOv1 mock contract tests
- `test/SkinnyOptimisticOracleBot.ts` - Skinny OO mock contract tests
