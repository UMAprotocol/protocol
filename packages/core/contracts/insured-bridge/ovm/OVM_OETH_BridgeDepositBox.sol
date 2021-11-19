pragma solidity ^0.8.0;

import "./OVM_BridgeDepositBox.sol";

/**
 * @title OVM_OETH_BridgeDepositBox
 * @dev Modified version of OVM_BridgeDepositBox that supports Optimism ETH being sent over the canonical bridge as ETH.
 * This is re-wrapped to WETH on L2. All other functionality remains the same.
 */

contract OVM_OETH_BridgeDepositBox is OVM_BridgeDepositBox {
    // l2Eth is ETH on Optimism. This acts as both an ERC20 and ETH on the OVM. In production is deployed at address
    // 0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000. We need to know the address in this contract as the Optimism bridge
    // does not support WETH so we need to unwrap to ETH first then send over ETH.
    address public l2Eth;
    // The L1 ETH Wrapper contract receives ETH, wraps it to WETH and sends it to the BridgePool. This enables the
    // us to keep the same L1 contracts while supporting Optimsim.
    address public l1EthWrapper;

    /**
     * @notice Construct the Optimism Bridge Deposit Box
     * @param _crossDomainAdmin Address of the L1 contract that can call admin functions on this contract from L1.
     * @param _minimumBridgingDelay Minimum second that must elapse between L2->L1 token transfer to prevent dos.
     * @param _chainId L2 Chain identifier this deposit box is deployed on.
     * @param _l1Weth Address of Weth on L1. Used to inform if a bridging action should wrap ETH to WETH, if the desired
     *      asset-to-bridge is for a whitelisted token mapped to this L1 Weth token.
     * @param _l2Eth Address of ETH on L2. If someone wants to bridge L2 Weth from this contract to L1, then L2 ETH
     *     should be sent over the Optimism bridge.
     * @param _l1EthWrapper Address of custom ETH wrapper on L1. Any ETH sent to this contract will be wrapped to WETH
     *     and sent to the WETH Bridge Pool.
     * @param timerAddress Timer used to synchronize contract time in testing. Set to 0x000... in production.
     */
    constructor(
        address _crossDomainAdmin,
        uint64 _minimumBridgingDelay,
        uint256 _chainId,
        address _l1Weth,
        address _l2Eth,
        address _l1EthWrapper,
        address timerAddress
    ) OVM_BridgeDepositBox(_crossDomainAdmin, _minimumBridgingDelay, _chainId, _l1Weth, timerAddress) {
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

        // If the l1Token mapping to the l2Token is l1Weth, then to work with the canonical optimism bridge, we first
        //  unwrap it to ETH then bridge the newly unwraped L2 ETH over the canonical bridge. On L1 the l1EthWrapper will
        // re-wrap the ETH to WETH and send it to the WETH bridge pool.
        if (whitelistedTokens[l2Token].l1Token == l1Weth) {
            WETH9Like(l2Token).withdraw(bridgeDepositBoxBalance);
            l2Token = l2Eth;
            bridgePool = l1EthWrapper;
        }
        IL2ERC20Bridge(Lib_PredeployAddresses.L2_STANDARD_BRIDGE).withdrawTo(
            l2Token, // _l2Token. Address of the L2 token to bridge over.
            bridgePool, // _to. Withdraw, over the bridge, to the l1 withdraw contract.
            bridgeDepositBoxBalance, // _amount. Send the full balance of the deposit box to bridge.
            l1Gas, // _l1Gas. Unused, but included for potential forward compatibility considerations
            "" // _data. We don't need to send any data for the bridging action.
        );

        emit TokensBridged(l2Token, bridgeDepositBoxBalance, l1Gas, msg.sender);
    }

    // Fallback function to enable this contract to receive ETH sent to it via WETH unwrapping. When l2ETH is unwrapped
    // from l2WETH, the l2ETH is sent to this contract before being sent over the canonical Optimism's bridge.
    receive() external payable {}

    fallback() external payable {}
}
