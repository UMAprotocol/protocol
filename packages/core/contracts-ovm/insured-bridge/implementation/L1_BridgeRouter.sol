// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.7.6;

import "@eth-optimism/contracts/libraries/bridge/OVM_CrossDomainEnabled.sol";

import "./L2_BridgeDepositBox.sol";

contract BridgeRouter is OVM_CrossDomainEnabled {
    address public l1Owner;
    address public l2DepositBox;

    event AddedL2DepositContract(address l2Contract);
    event WhitelistedToken(address l1Token, address l2Token);
    event L2DepositRelayed(
        address sender,
        address recipient,
        address originToken,
        address destinationToken,
        address relayer,
        uint256 amount,
        uint256 realizedFee,
        uint256 maxFee
    );
    event LPDepositCollateral(address token, uint256 amount, uint256 lpTokensMinted, address caller);
    event L2TransferSpeedUp(uint256 transactionId, address fastRelayer);
    event FinalizedL2Transfer(uint256 transferId, address caller);
    event TransferDisputeSettled(uint256 transferId, address caller, bool outcome);

    modifier onlyOwner() {
        require(msg.sender == l1Owner, "Not owner");
        _;
    }

    constructor(address _l1messenger, address _l1Owner) OVM_CrossDomainEnabled(_l1messenger) {
        l1Owner = _l1Owner;
    }

    // Admin functions

    function setL2DepositContract(address l2Contract) public onlyOwner {}

    function whitelistToken(address l1Token, address l2Token) public onlyOwner {}

    function pauseL2Deposits() public onlyOwner {}

    // Liquidity provider functions

    function deposit(address l1Token, uint256 amount) public {}

    function withdraw(address lpToken, uint256 amount) public {}

    // Relayer functions

    function relayL2Transfer(
        uint256 transferId,
        uint256 timestamp,
        address recipient,
        address originToken,
        uint256 amount,
        uint256 realizedFee,
        uint256 maxFee
    ) public {}

    function speedUpL2Transfer(uint256 transferId) public {}

    function finalizeL2Transfer(uint256 transferId) public {}

    function settleDisputedTransfer(uint256 transferId, address initialRelayer) public {}
}
