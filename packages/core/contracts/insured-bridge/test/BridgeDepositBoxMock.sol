// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../BridgeDepositBox.sol";

contract BridgeDepositBoxMock is BridgeDepositBox {
    using SafeERC20 for IERC20;

    // Address of the L1 contract that acts as the owner of this Bridge deposit box.
    address public bridgeAdmin;

    event SetBridgeAdmin(address newBridgeAdmin);

    modifier onlyBridgeAdmin() {
        require(msg.sender == bridgeAdmin, "Not bridge admin");
        _;
    }

    /**
     * @notice Ownable bridge deposit box. Used for testing environments that don't have specific l1/l2 messaging logic.
     */

    constructor(
        address _bridgeAdmin,
        uint64 _minimumBridgingDelay,
        address _l1Weth,
        address timerAddress
    ) BridgeDepositBox(_minimumBridgingDelay, 10, _l1Weth, timerAddress) {
        _setBridgeAdmin(_bridgeAdmin);
    }

    /**************************************
     *          ADMIN FUNCTIONS           *
     **************************************/

    /**
     * @notice Changes the L1 administrator associated with this L2 deposit deposit box.
     * @dev Only callable by the existing bridgeAdmin via the optimism cross domain messenger.
     * @param _bridgeAdmin address of the new L1 admin contract.
     */
    function setCrossDomainAdmin(address _bridgeAdmin) public onlyBridgeAdmin() {
        _setBridgeAdmin(_bridgeAdmin);
    }

    /**
     * @notice Changes the minimum time in seconds that must elapse between withdraws from L2->L1.
     * @dev Only callable by the existing bridgeAdmin via the optimism cross domain messenger.
     * @param _minimumBridgingDelay the new minimum delay.
     */
    function setMinimumBridgingDelay(uint64 _minimumBridgingDelay) public onlyBridgeAdmin() {
        _setMinimumBridgingDelay(_minimumBridgingDelay);
    }

    /**
     * @notice Enables L1 owner to whitelist a L1 Token <-> L2 Token pair for bridging.
     * @dev Only callable by the existing bridgeAdmin via the optimism cross domain messenger.
     * @param l1Token Address of the canonical L1 token. This is the token users will receive on Ethereum.
     * @param l2Token Address of the L2 token representation. This is the token users would deposit on optimism.
     * @param l1BridgePool Address of the L1 withdrawal pool linked to this L2+L1 token.
     */
    function whitelistToken(
        address l1Token,
        address l2Token,
        address l1BridgePool
    ) public onlyBridgeAdmin() {
        _whitelistToken(l1Token, l2Token, l1BridgePool);
    }

    /**
     * @notice L1 owner can enable/disable deposits for a whitelisted token.
     * @dev Only callable by the existing bridgeAdmin via the optimism cross domain messenger.
     * @param _l2Token address of L2 token to enable/disable deposits for.
     * @param _depositsEnabled bool to set if the deposit box should accept/reject deposits.
     */
    function setEnableDeposits(address _l2Token, bool _depositsEnabled) public onlyBridgeAdmin() {
        _setEnableDeposits(_l2Token, _depositsEnabled);
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
     * @param l1Gas Unused by optimism, but included for potential forward compatibility considerations.
     */
    function bridgeTokens(address l2Token, uint32 l1Gas) public override nonReentrant() {
        uint256 bridgeDepositBoxBalance = TokenLike(l2Token).balanceOf(address(this));
        require(bridgeDepositBoxBalance > 0, "can't bridge zero tokens");
        require(canBridge(l2Token), "non-whitelisted token or last bridge too recent");

        whitelistedTokens[l2Token].lastBridgeTime = uint64(getCurrentTime());

        // Note in this test contract we simply send the l2 tokens to the l1BridgePool.
        IERC20(l2Token).safeTransfer(whitelistedTokens[l2Token].l1BridgePool, bridgeDepositBoxBalance);

        emit TokensBridged(l2Token, bridgeDepositBoxBalance, l1Gas, msg.sender);
    }

    /**************************************
     *         INTERNAL FUNCTIONS         *
     **************************************/

    function _setBridgeAdmin(address _l1BridgeAdmin) internal {
        require(_l1BridgeAdmin != address(0), "Bad bridge router address");
        bridgeAdmin = _l1BridgeAdmin;
        emit SetBridgeAdmin(bridgeAdmin);
    }
}
