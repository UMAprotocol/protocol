# Change Log

Any modifications to original source code can be found in this document. Original sources are also listed here.

## interfaces

- **[iAVM_Inbox.sol](https://github.com/makerdao/arbitrum-dai-bridge/blob/7f1b47ef65a43f1696c5f1681109daac127d9c95/contracts/arbitrum/IInbox.sol):**
  - Bumped solidity version to >= 0.8.x
  - Removed functions from interface that are not used by AVM_CrossDomainEnabled.sol
  - Removed IMessageProvider inheritance.
