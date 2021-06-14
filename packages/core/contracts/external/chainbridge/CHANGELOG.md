# Change Log

Any modifications to original source code can be found in this document. Original sources are also listed here.

## chainbridge

- **[Bridge.sol](https://github.com/ChainSafe/chainbridge-solidity/blob/849db5657b8ce7c340a8847078de87d3a9e421f1/contracts/Bridge.sol):**
  - Changed version from from `0.6.4` --> `0.8`
  - Changed imported `Pausable` and `SafeMath` contracts to `@openzeppelin/contracts` implementations.

## handlers

- **[GenericHandler.sol](https://github.com/ChainSafe/chainbridge-solidity/blob/849db5657b8ce7c340a8847078de87d3a9e421f1/contracts/handlers/GenericHandler.sol):**
  - Changed version from from `0.6.4` --> `0.8`

## interfaces

- **[IBridge.sol](https://github.com/ChainSafe/chainbridge-solidity/blob/849db5657b8ce7c340a8847078de87d3a9e421f1/contracts/interfaces/IBridge.sol):**
  - Changed version from from `0.6.4` --> `0.8`
  - Added `deposit(uint8 destinationChainID, bytes32 resourceID, bytes data)` to interface so that `SinkOracle` and `SourceOracle` contracts can access it.
- **[IDepositExecute.sol](https://github.com/ChainSafe/chainbridge-solidity/blob/849db5657b8ce7c340a8847078de87d3a9e421f1/contracts/interfaces/IDepositExecute.sol):**
  - Changed version from from `0.6.4` --> `0.8`
- **[IERCHandler.sol](https://github.com/ChainSafe/chainbridge-solidity/blob/849db5657b8ce7c340a8847078de87d3a9e421f1/contracts/interfaces/IERCHandler.sol):**
  - Changed version from from `0.6.4` --> `0.8`
- **[IGenericHandler.sol](https://github.com/ChainSafe/chainbridge-solidity/blob/849db5657b8ce7c340a8847078de87d3a9e421f1/contracts/interfaces/IGenericHandler.sol):**
  - Changed version from from `0.6.4` --> `0.8`
