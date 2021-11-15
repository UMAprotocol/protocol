// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../BridgeDepositBox.sol";
import "../../external/avm/AVM_CrossDomainEnabled.sol";

interface StandardBridgeLike {
    function outboundTransfer(
        address _l1Token,
        address _to,
        uint256 _amount,
        bytes calldata _data
    ) external payable returns (bytes memory);
}

/**
 * @notice AVM specific bridge deposit box.
 * @dev Uses AVM cross-domain-enabled logic for access control.
 */

contract AVM_BridgeDepositBox is BridgeDepositBox, AVM_CrossDomainEnabled {
    // Address of the L1 contract that acts as the owner of this Bridge deposit box.
    address public crossDomainAdmin;

    // Address of the Arbitrum L2 token gateway.
    address public l2GatewayRouter;

    event SetXDomainAdmin(address indexed newAdmin);

    /**
     * @notice Construct the Arbitrum Bridge Deposit Box
     * @param _l2GatewayRouter Address of the Arbitrum L2 token gateway router for sending tokens from L2->L1.
     * @param _crossDomainAdmin Address of the L1 contract that can call admin functions on this contract from L1.
     * @param _minimumBridgingDelay Minimum second that must elapse between L2->L1 token transfer to prevent dos.
     * @param _chainId L2 Chain identifier this deposit box is deployed on.
     * @param _l1Weth Address of Weth on L1. Used to inform if the deposit should wrap ETH to WETH, if deposit is ETH.
     * @param timerAddress Timer used to synchronize contract time in testing. Set to 0x000... in production.
     */
    constructor(
        address _l2GatewayRouter,
        address _crossDomainAdmin,
        uint64 _minimumBridgingDelay,
        uint256 _chainId,
        address _l1Weth,
        address timerAddress
    ) BridgeDepositBox(_minimumBridgingDelay, _chainId, _l1Weth, timerAddress) {
        l2GatewayRouter = _l2GatewayRouter;
        _setCrossDomainAdmin(_crossDomainAdmin);
    }

    /**************************************
     *          ADMIN FUNCTIONS           *
     **************************************/

    /**
     * @notice Changes the L1 contract that can trigger admin functions on this L2 deposit deposit box.
     * @dev This should be set to the address of the L1 contract that ultimately relays a cross-domain message, which
     * is expected to be the Arbitrum_Messenger.
     * @dev Only callable by the existing crossDomainAdmin via the Arbitrum cross domain messenger.
     * @param newCrossDomainAdmin address of the new L1 admin contract.
     */
    function setCrossDomainAdmin(address newCrossDomainAdmin) public onlyFromCrossDomainAccount(crossDomainAdmin) {
        _setCrossDomainAdmin(newCrossDomainAdmin);
    }

    /**
     * @notice Changes the minimum time in seconds that must elapse between withdraws from L2->L1.
     * @dev Only callable by the existing crossDomainAdmin via the Arbitrum cross domain messenger.
     * @param newMinimumBridgingDelay the new minimum delay.
     */
    function setMinimumBridgingDelay(uint64 newMinimumBridgingDelay)
        public
        onlyFromCrossDomainAccount(crossDomainAdmin)
    {
        _setMinimumBridgingDelay(newMinimumBridgingDelay);
    }

    /**
     * @notice Enables L1 owner to whitelist a L1 Token <-> L2 Token pair for bridging.
     * @dev Only callable by the existing crossDomainAdmin via the Arbitrum cross domain messenger.
     * @param l1Token Address of the canonical L1 token. This is the token users will receive on Ethereum.
     * @param l2Token Address of the L2 token representation. This is the token users would deposit on Arbitrum.
     * @param l1BridgePool Address of the L1 withdrawal pool linked to this L2+L1 token.
     */
    function whitelistToken(
        address l1Token,
        address l2Token,
        address l1BridgePool
    ) public onlyFromCrossDomainAccount(crossDomainAdmin) {
        _whitelistToken(l1Token, l2Token, l1BridgePool);
    }

    /**
     * @notice L1 owner can enable/disable deposits for a whitelisted token.
     * @dev Only callable by the existing crossDomainAdmin via the Arbitrum cross domain messenger.
     * @param l2Token address of L2 token to enable/disable deposits for.
     * @param depositsEnabled bool to set if the deposit box should accept/reject deposits.
     */
    function setEnableDeposits(address l2Token, bool depositsEnabled)
        public
        onlyFromCrossDomainAccount(crossDomainAdmin)
    {
        _setEnableDeposits(l2Token, depositsEnabled);
    }

    /**************************************
     *          RELAYER FUNCTIONS         *
     **************************************/

    /**
     * @notice Called by relayer (or any other EOA) to move a batch of funds from the deposit box, through the canonical
     *      token bridge, to the L1 Withdraw box.
     * @dev The frequency that this function can be called is rate limited by the `minimumBridgingDelay` to prevent spam
     *      on L1 as the finalization of a L2->L1 tx is quite expensive.
     * @param l2Token L2 token to relay over the canonical bridge.
     * @param l1Gas Unused by Arbitrum, but included for potential forward compatibility considerations.
     */
    function bridgeTokens(address l2Token, uint32 l1Gas) public override nonReentrant() {
        uint256 bridgeDepositBoxBalance = TokenLike(l2Token).balanceOf(address(this));
        require(bridgeDepositBoxBalance > 0, "can't bridge zero tokens");
        require(canBridge(l2Token), "non-whitelisted token or last bridge too recent");

        whitelistedTokens[l2Token].lastBridgeTime = uint64(getCurrentTime());

        StandardBridgeLike(l2GatewayRouter).outboundTransfer(
            whitelistedTokens[l2Token].l1Token, // _l1Token. Address of the L1 token to bridge over.
            whitelistedTokens[l2Token].l1BridgePool, // _to. Withdraw, over the bridge, to the l1 withdraw contract.
            bridgeDepositBoxBalance, // _amount. Send the full balance of the deposit box to bridge.
            "" // _data. We don't need to send any data for the bridging action.
        );

        emit TokensBridged(l2Token, bridgeDepositBoxBalance, l1Gas, msg.sender);
    }

    /**************************************
     *         INTERNAL FUNCTIONS         *
     **************************************/

    function _setCrossDomainAdmin(address newCrossDomainAdmin) internal {
        require(newCrossDomainAdmin != address(0), "Empty address");
        crossDomainAdmin = newCrossDomainAdmin;
        emit SetXDomainAdmin(crossDomainAdmin);
    }
}
