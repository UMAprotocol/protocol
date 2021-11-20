# Change Log

Any modifications to original source code can be found in this document. Original sources are also listed here.

## interfaces

- **[iArbitrum_Inbox.sol](https://github.com/makerdao/arbitrum-dai-bridge/blob/7f1b47ef65a43f1696c5f1681109daac127d9c95/contracts/arbitrum/IInbox.sol):**

  - Bumped solidity version to >= 0.8.x
  - Removed functions from interface that are not used by `ArbitrumCrossDomainEnabled.sol` or `AVM_CrossDomainEnabled.sol`
  - Removed IMessageProvider inheritance.

- **[iArbitrum_Outbox.sol](https://github.com/OffchainLabs/arbitrum-tutorials/blob/4761fa1ba1f1eca95e8c03f24f1442ed5aecd8bd/packages/arb-shared-dependencies/contracts/Outbox.sol):**

  - Bumped solidity version to >= 0.8.x
  - Removed functions from interface that are not used by `ArbitrumCrossDomainEnabled.sol` or `AVM_CrossDomainEnabled.sol`

- **[ArbSys.sol](https://github.com/makerdao/arbitrum-dai-bridge/blob/54a2109a97c5b1504824c6317d358e2d2733b5a3/contracts/arbitrum/ArbSys.sol):**

  - Bumped solidity version to >= 0.8.x

## abstract contracts

- **[AVM_CrossDomainEnabled.sol](https://github.com/makerdao/arbitrum-dai-bridge/blob/34acc39bc6f3a2da0a837ea3c5dbc634ec61c7de/contracts/l2/L2CrossDomainEnabled.sol):**
  - Bumped solidity version to >= 0.8.x
