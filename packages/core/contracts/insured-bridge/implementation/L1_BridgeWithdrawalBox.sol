// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.7.6;

import { OVM_CrossDomainEnabled } from "@eth-optimism/contracts/libraries/bridge/OVM_CrossDomainEnabled.sol";

contract WithdrawalBox is OVM_CrossDomainEnabled {
    address public l1Owner;

    modifier onlyOwner() {
        require(msg.sender == l1Owner, "Not owner");
        _;
    }

    constructor(address _l1messenger, address _l1Owner) OVM_CrossDomainEnabled(_l1messenger) {
        l1Owner = _l1Owner;
    }

    function setWithdrawalContract(address withdrawalContract) public onlyOwner {}

    function whitelistToken(address originToken, address destinationToken) public onlyOwner {}

    function disableDepositContract() public onlyOwner {}

    function deposit(
        address recipient,
        address l1Token,
        uint256 amount,
        uint256 maxFee
    ) public {}

    function withdraw(address lpToken, uint256 amount) public {}

    function speedUpL2Transfer(uint256 transferId) public {}

    function finalizeL2Transfer(uint256 transferId) public {}

    function settleDisputedTransfer(uint256 transferId, address initialRelayer) public {}

    function priceDisputed(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 refund,
        address disputer
    ) public {}
}
