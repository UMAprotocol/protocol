// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.7.6;

import { OVM_CrossDomainEnabled } from "@eth-optimism/contracts/libraries/bridge/OVM_CrossDomainEnabled.sol";

contract OVM_L2BridgeDepositBox is OVM_CrossDomainEnabled {
    address public l1WithdrawContract;

    bool public depositsEnabled = true;

    // Mapping of L2Token to L1Token.
    mapping(address => address) public whitelistedTokens;

    event Deposit(
        uint256 transferId,
        uint256 timestamp,
        address sender,
        address recipient,
        address l1Token,
        uint256 amount,
        uint256 networkId,
        uint256 maxFee
    );
    event L1WithdrawContractChanged(address oldL1WithdrawContract, address newL1WithdrawContract);
    event TokenWhitelisted(address l1Token, address l2Token);
    event DepositsEnabled(bool enabledResultantState);

    modifier onlyIfDepositsEnabled() {
        require(depositsEnabled, "Contract is disabled");
        _;
    }

    constructor(address _l2CrossDomainMessenger, address _l1WithdrawContract)
        OVM_CrossDomainEnabled(_l2CrossDomainMessenger)
    {
        l1WithdrawContract = _l1WithdrawContract;
    }

    // Admin functions

    function changeL1WithdrawContract(address newL1WithdrawContract)
        public
        onlyFromCrossDomainAccount(l1WithdrawContract)
    {
        emit L1WithdrawContractChanged(l1WithdrawContract, newL1WithdrawContract);
        l1WithdrawContract = newL1WithdrawContract;
    }

    function whitelistToken(address l1Token, address l2Token) public onlyFromCrossDomainAccount(l1WithdrawContract) {
        whitelistedTokens[l2Token] = l1Token;

        emit TokenWhitelisted(l1Token, l2Token);
    }

    function setEnableDeposits(bool _depositsEnabled) public onlyFromCrossDomainAccount(l1WithdrawContract) {
        depositsEnabled = _depositsEnabled;
        emit DepositsEnabled(_depositsEnabled);
    }

    // Depositor functions

    function deposit(
        address recipient,
        address l1Token,
        uint256 amount,
        uint256 maxFee
    ) public onlyIfDepositsEnabled() {}
}
