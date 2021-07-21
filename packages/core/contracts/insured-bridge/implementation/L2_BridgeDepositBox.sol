// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity >=0.7.6;

import { OVM_CrossDomainEnabled } from "@eth-optimism/contracts/libraries/bridge/OVM_CrossDomainEnabled.sol";

contract BridgeDepositBox is OVM_CrossDomainEnabled {
    address public l1Owner;

    constructor(address _l2CrossDomainMessenger, address _l1Owner) OVM_CrossDomainEnabled(_l2CrossDomainMessenger) {
        l1Owner = _l1Owner;
    }

    function addL2DepositContract(address l2Contract, uint256 networkId) public onlyFromCrossDomainAccount(l1Owner) {}

    function transferL1Ownership(address newL1Owner) public onlyFromCrossDomainAccount(l1Owner) {
        l1Owner = newL1Owner;
    }

    function whitelistToken(
        address l1Token,
        address l2Token,
        uint256 networkId
    ) public {}

    function deposit(address l1Token, uint256 amount) public {}
}
