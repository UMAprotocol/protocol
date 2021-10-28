# Change Log

Any modifications to original source code can be found in this document. Original sources are also listed here.

## interfaces

- **[iArbitrum_Inbox.sol](https://github.com/makerdao/arbitrum-dai-bridge/blob/7f1b47ef65a43f1696c5f1681109daac127d9c95/contracts/arbitrum/IInbox.sol):**

  - Bumped solidity version to >= 0.8.x
  - Removed functions from interface that are not used by ArbitrumCrossDomainEnabled.sol
  - Removed IMessageProvider inheritance.

- **[AVM_CrossDomainEnabled.sol](https://github.com/makerdao/arbitrum-dai-bridge/blob/34acc39bc6f3a2da0a837ea3c5dbc634ec61c7de/contracts/l2/L2CrossDomainEnabled.sol):**
  - Bumped solidity version to >= 0.8.x
