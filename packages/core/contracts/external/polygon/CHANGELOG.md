# Change Log

Any modifications to original source code can be found in this document. Original sources are also listed here.

## lib

- **[Merkle.sol](https://github.com/fx-portal/contracts/blob/2b064b1d8d40493c78682e9afc40ea20dc882356/contracts/lib/Merkle.sol):**
  - Changed version from from `0.7.3` --> `0.8`
- **[MerklePatriciaProof.sol](https://github.com/fx-portal/contracts/blob/2b064b1d8d40493c78682e9afc40ea20dc882356/contracts/lib/MerklePatriciaProof.sol):**
  - Changed version from from `0.7.3` --> `0.8`
- **[RLPReader.sol](https://github.com/fx-portal/contracts/blob/2b064b1d8d40493c78682e9afc40ea20dc882356/contracts/lib/RLPReader.sol):**
  - Changed version from from `0.7.3` --> `0.8`
  - Cannot convert directly from `uint256` --> `address` in Solidity v8, apply intermediate cast to `uint160` [here](https://github.com/fx-portal/contracts/blob/2b064b1d8d40493c78682e9afc40ea20dc882356/contracts/lib/RLPReader.sol#L95). More details [here](https://docs.soliditylang.org/en/v0.8.0/080-breaking-changes.html#new-restrictions)
  - Cannot rely on wrapping arithmetic in Solidity v8, must explicitly catch underflow/overflow with an `unchecked {...}` statement around [this code block](https://github.com/fx-portal/contracts/blob/2b064b1d8d40493c78682e9afc40ea20dc882356/contracts/lib/RLPReader.sol#L251)

## tunnel

- **[FxBaseChildTunnel.sol](https://github.com/fx-portal/contracts/blob/2b064b1d8d40493c78682e9afc40ea20dc882356/contracts/tunnel/FxBaseChildTunnel.sol):**
  - Changed version from from `0.7.3` --> `0.8`
- **[FxBaseRootTunnel.sol](https://github.com/fx-portal/contracts/blob/2b064b1d8d40493c78682e9afc40ea20dc882356/contracts/tunnel/FxBaseRootTunnel.sol):**
  - Changed version from from `0.7.3` --> `0.8`

# test

- **[FxChildMock.sol](https://github.com/fx-portal/contracts/blob/2b064b1d8d40493c78682e9afc40ea20dc882356/contracts/FxChild.sol):**
  - Changed version from from `0.7.3` --> `0.8`
  - Changed [required caller](https://github.com/fx-portal/contracts/blob/2b064b1d8d40493c78682e9afc40ea20dc882356/contracts/FxChild.sol#L28) for `onStateReceive()` to be an address that is stored in contract upon construction in `systemCaller` variable. This enables easier testing.
- **[FxRootMock.sol](https://github.com/fx-portal/contracts/blob/2b064b1d8d40493c78682e9afc40ea20dc882356/contracts/FxRoot.sol):**
  - Changed version from from `0.7.3` --> `0.8`
- **[StateSyncMock.sol](https://github.com/maticnetwork/pos-portal/blob/d06271188412a91ab9e4bdea4bbbfeb6cb9d7669/contracts/root/StateSender/DummyStateSender.sol):**
  - Inspired by, but not copied directly from, the linked contract.
