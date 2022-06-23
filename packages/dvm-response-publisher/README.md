listen for `PriceRequestAdded` events from the `Voting` contract https://github.com/UMAprotocol/protocol/blob/9fabd6cd7d2f1d0508199f779f64957f950c5f42/packages/core/contracts/oracle/implementation/Voting.sol#L287

determine if the price has been added with the `hasPrice` method in the `Voting` contract https://github.com/UMAprotocol/protocol/blob/9fabd6cd7d2f1d0508199f779f64957f950c5f42/packages/core/contracts/oracle/implementation/Voting.sol#L304

call `publishPrice` in the `OracleHub` contract https://github.com/UMAprotocol/protocol/blob/master/packages/core/contracts/cross-chain-oracle/OracleHub.sol#L72

call `stampAncillaryData` in the `OracleSpoke` contract https://github.com/UMAprotocol/protocol/blob/e703fead223c1b5a43bba6d976bc66f8c469d314/packages/core/contracts/cross-chain-oracle/OracleSpoke.sol#L160

