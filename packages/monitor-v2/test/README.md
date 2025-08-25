# Monitor V2 Test Suite

This directory contains tests for the Monitor V2 package, including the unified OptimisticOracle settlement bot that supports multiple Oracle versions.

## Oracle Bot Tests

### OptimisticOracleV2Bot.ts ✅

Tests for the existing OptimisticOracle V2 settlement functionality:

- ✅ **Settle price request happy path**: Verifies proper settlement of expired price requests
- ✅ **Does not settle before liveness**: Ensures requests aren't settled prematurely

### OptimisticOracleV1Bot.ts ✅ (NEW)

Tests for OptimisticOracle V1 settlement functionality:

- ✅ **Should identify OptimisticOracle V1 settlement**: Tests basic settlement logic dispatch
- ✅ **Should handle invalid OptimisticOracle V1 contracts gracefully**: Tests error handling

### SkinnyOptimisticOracleBot.ts ✅ (NEW)

Tests for SkinnyOptimisticOracle settlement functionality:

- ✅ **Should identify Skinny OptimisticOracle settlement**: Tests settlement logic dispatch
- ✅ **Should handle Skinny OptimisticOracle request reconstruction**: Tests request parameter handling
- ✅ **Should handle invalid Skinny OptimisticOracle contracts gracefully**: Tests error handling

### OptimisticOracleV3Bot.ts ✅

Tests for OptimisticOracle V3 assertion settlement:

- ✅ **Settle assertion happy path**: Tests successful assertion settlement
- ✅ **Settle assertion with dispute**: Tests disputed assertion settlement

## Running Tests

### All Oracle Bot Tests

```bash
npx hardhat test test/OptimisticOracle*Bot.ts
```

### Individual Test Files

```bash
# OptimisticOracle V1 tests
npx hardhat test test/OptimisticOracleV1Bot.ts

# SkinnyOptimisticOracle tests
npx hardhat test test/SkinnyOptimisticOracleBot.ts

# OptimisticOracle V2 tests
npx hardhat test test/OptimisticOracleV2Bot.ts

# OptimisticOracle V3 tests
npx hardhat test test/OptimisticOracleV3Bot.ts
```

## Test Architecture

### Unified Settlement Testing

The tests verify that the unified settlement dispatcher correctly routes to the appropriate Oracle-specific settlement logic:

```
settleRequests() dispatcher
├── OptimisticOracle → settleOOv1Requests()
├── SkinnyOptimisticOracle → settleSkinnyOORequests()
└── OptimisticOracleV2 → settleOOv2Requests()
```

### Mock Contract Approach

For Oracle V1 and Skinny OO tests, we use mock contract addresses since these are legacy/deprecated contracts. The tests verify:

- Proper error handling for invalid contracts
- Correct routing to settlement logic
- Appropriate log output and error messages

### Integration Testing

The OptimisticOracle V2 and V3 tests use full contract deployments via fixtures to test:

- End-to-end settlement workflows
- Proper event parsing and logging
- Gas estimation and transaction execution
- State validation and duplicate prevention

## Test Coverage

✅ **Dispatcher Logic**: All Oracle types are correctly routed  
✅ **Error Handling**: Invalid contracts and addresses are handled gracefully  
✅ **Settlement Logic**: Each Oracle type executes appropriate settlement functions  
✅ **Logging**: Proper debug and warning logs are generated  
✅ **Integration**: Full settlement workflows work end-to-end for active Oracle types

## Future Enhancements

- Add full integration tests for OptimisticOracle V1 when/if needed
- Add full integration tests for SkinnyOptimisticOracle with deployed contracts
- Add performance benchmarking across Oracle types
- Add gas usage comparison tests
