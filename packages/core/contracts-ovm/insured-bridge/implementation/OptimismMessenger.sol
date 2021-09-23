// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../external/OVM_CrossDomainEnabled.sol";

/**
 * @notice Sends cross chain messages Optimism/
 */
contract OptimismMessenger is OVM_CrossDomainEnabled {
    constructor(address _crossDomainMessenger) OVM_CrossDomainEnabled(_crossDomainMessenger) {}

    function sendCrossChainMessage(
        address target,
        uint32 gasLimit,
        bytes memory message
    ) external {
        sendCrossDomainMessage(target, gasLimit, message);
    }
}
