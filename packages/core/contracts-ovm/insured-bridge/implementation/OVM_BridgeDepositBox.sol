// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.7.6;

import { OVM_CrossDomainEnabled } from "@eth-optimism/contracts/libraries/bridge/OVM_CrossDomainEnabled.sol";

contract OVM_BridgeDepositBox is OVM_CrossDomainEnabled {
    address public l1Owner;

    event Deposit(
        uint256 transferId,
        uint256 timestamp,
        address sender,
        address recipient,
        address originToken,
        uint256 amount,
        uint256 networkId,
        uint256 maxFee
    );
    event WithdrawalContractSet(address withdrawalContract);
    event TokenWhitelisted(address originToken, address destinationToken);
    event DepositContractEnabledStateToggled(bool enabled);

    constructor(address _l2CrossDomainMessenger, address _l1Owner) OVM_CrossDomainEnabled(_l2CrossDomainMessenger) {
        l1Owner = _l1Owner;
    }

    // Admin functions

    function setWithdrawalContract(address withdrawalContract) public onlyFromCrossDomainAccount(l1Owner) {}

    function whitelistToken(address l1Token, address l2Token) public onlyFromCrossDomainAccount(l1Owner) {}

    function disableDepositContract() public onlyFromCrossDomainAccount(l1Owner) {}

    function transferL1Owner(address _l1Owner) public onlyFromCrossDomainAccount(l1Owner) {
        l1Owner = _l1Owner;
    }

    // Depositor functions

    function deposit(
        address recipient,
        address l1Token,
        uint256 amount,
        uint256 maxFee
    ) public {}
}
