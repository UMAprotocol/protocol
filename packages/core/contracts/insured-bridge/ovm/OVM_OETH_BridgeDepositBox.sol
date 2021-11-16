pragma solidity ^0.8.0;

import "./OVM_BridgeDepositBox.sol";

contract OVM_OETH_BridgeDepositBox is OVM_BridgeDepositBox {
    // Stored to work around Optimism not allowing for WETH to be bridge over the canonical bridge.
    address public l2Weth;
    address public l2Eth;
    address public l1EthWrapper;

    constructor(
        address _crossDomainAdmin,
        uint64 _minimumBridgingDelay,
        uint256 _chainId,
        address _l1Weth,
        address _l2Weth,
        address _l2Eth,
        address _l1EthWrapper,
        address timerAddress
    ) OVM_BridgeDepositBox(_crossDomainAdmin, _minimumBridgingDelay, _chainId, _l1Weth, timerAddress) {
        l2Weth = _l2Weth;
        l2Eth = _l2Eth;
        l1EthWrapper = _l1EthWrapper;
    }

    /**
     * @notice Called by relayer (or any other EOA) to move a batch of funds from the deposit box, through the canonical
     *     token bridge, to the L1 Withdraw box. Implementation is exactly the same as the standard OVM_BridgeDepositBox
     * except constructed to work with Optimism ETH by first unwrapping WETH then bridging OETH. The target on L1 is
     * not the bridgePool but to the l1EthWrapper that takes any ETH sent to it, wraps it and sends to the BridgePool.
     * @dev The frequency that this function can be called is rate limited by the `minimumBridgingDelay` to prevent spam
     *      on L1 as the finalization of a L2->L1 tx is quite expensive.
     * @param l2Token L2 token to relay over the canonical bridge.
     * @param l1Gas Unused by optimism, but included for potential forward compatibility considerations.
     */
    function bridgeTokens(address l2Token, uint32 l1Gas) public override nonReentrant() {
        uint256 bridgeDepositBoxBalance = TokenLike(l2Token).balanceOf(address(this));
        require(bridgeDepositBoxBalance > 0, "can't bridge zero tokens");
        require(canBridge(l2Token), "non-whitelisted token or last bridge too recent");

        whitelistedTokens[l2Token].lastBridgeTime = uint64(getCurrentTime());

        address bridgePool = whitelistedTokens[l2Token].l1BridgePool;

        // If the L2 token is L2WETH then, to work with the canonical optimism bridge, we first unwrap it to ETH then
        // bridge ETH over the canonical bridge. On L1 the l1EthWrapper will re-wrap the ETH to WETH and send it to
        // the WETH bridge pool.
        if (l2Token == l2Weth) {
            WETH9Like(l2Token).withdraw(bridgeDepositBoxBalance);
            l2Token = l2Eth;
            bridgePool = l1EthWrapper;
        }
        StandardBridgeLike(Lib_PredeployAddresses.L2_STANDARD_BRIDGE).withdrawTo(
            l2Token, // _l2Token. Address of the L2 token to bridge over.
            bridgePool, // _to. Withdraw, over the bridge, to the l1 withdraw contract.
            bridgeDepositBoxBalance, // _amount. Send the full balance of the deposit box to bridge.
            l1Gas, // _l1Gas. Unused, but included for potential forward compatibility considerations
            "" // _data. We don't need to send any data for the bridging action.
        );

        emit TokensBridged(l2Token, bridgeDepositBoxBalance, l1Gas, msg.sender);
    }

    receive() external payable {}

    fallback() external payable {}
}
