// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../common/implementation/Testable.sol";
import "../common/implementation/Lockable.sol";

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface TokenLike {
    function balanceOf(address guy) external returns (uint256 wad);
}

interface WETH9Like {
    function deposit() external payable;

    function withdraw(uint256 wad) external;
}

/**
 * @title OVM Bridge Deposit Box.
 * @notice Accepts deposits on Optimism L2 to relay to Ethereum L1 as part of the UMA insured bridge system.
 */

abstract contract BridgeDepositBox is Testable, Lockable {
    using SafeERC20 for IERC20;
    /*************************************
     *  OVM DEPOSIT BOX DATA STRUCTURES  *
     *************************************/

    // ChainID of the L2 this deposit box is deployed on.
    uint256 public chainId;

    // Address of WETH on L1. If the deposited token maps to this L1 token then wrap ETH to WETH on the users behalf.
    address public l1Weth;

    // Track the total number of deposits. Used as a unique identifier for bridged transfers.
    uint256 public numberOfDeposits;

    struct L2TokenRelationships {
        address l1Token;
        address l1BridgePool;
        uint64 lastBridgeTime;
        bool depositsEnabled;
    }

    // Mapping of whitelisted L2Token to L2TokenRelationships. Contains L1 TokenAddress and the last time this token
    // type was bridged. Used to rate limit bridging actions to rate limit withdraws to L1.
    mapping(address => L2TokenRelationships) public whitelistedTokens;

    // Minimum time that must elapse between bridging actions for a given token. Used to rate limit bridging back to L1.
    uint64 public minimumBridgingDelay;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event SetMinimumBridgingDelay(uint64 newMinimumBridgingDelay);
    event WhitelistToken(address l1Token, address l2Token, uint64 lastBridgeTime, address bridgePool);
    event DepositsEnabled(address l2Token, bool depositsEnabled);
    event FundsDeposited(
        uint256 chainId,
        uint256 depositId,
        address l1Recipient,
        address l2Sender,
        address l1Token,
        address l2Token,
        uint256 amount,
        uint64 slowRelayFeePct,
        uint64 instantRelayFeePct,
        uint64 quoteTimestamp
    );
    event TokensBridged(address indexed l2Token, uint256 numberOfTokensBridged, uint256 l1Gas, address indexed caller);

    /****************************************
     *               MODIFIERS              *
     ****************************************/

    modifier onlyIfDepositsEnabled(address l2Token) {
        require(whitelistedTokens[l2Token].depositsEnabled, "Contract is disabled");
        _;
    }

    /**
     * @notice Construct the Bridge Deposit Box
     * @param _minimumBridgingDelay Minimum seconds that must elapse between L2 -> L1 token transfer to prevent dos.
     * @param _chainId Chain identifier for the Bridge deposit box.
     * @param _l1Weth Address of Weth on L1. Used to inform if the deposit should wrap ETH to WETH, if deposit is ETH.
     * @param timerAddress Timer used to synchronize contract time in testing. Set to 0x000... in production.
     */
    constructor(
        uint64 _minimumBridgingDelay,
        uint256 _chainId,
        address _l1Weth,
        address timerAddress
    ) Testable(timerAddress) {
        _setMinimumBridgingDelay(_minimumBridgingDelay);
        chainId = _chainId;
        l1Weth = _l1Weth;
    }

    /**************************************
     *          ADMIN FUNCTIONS           *
     **************************************/

    /**
     * @notice Changes the minimum time in seconds that must elapse between withdraws from L2 -> L1.
     * @param newMinimumBridgingDelay the new minimum delay.
     */
    function _setMinimumBridgingDelay(uint64 newMinimumBridgingDelay) internal {
        minimumBridgingDelay = newMinimumBridgingDelay;
        emit SetMinimumBridgingDelay(minimumBridgingDelay);
    }

    /**
     * @notice Enables L1 owner to whitelist a L1 Token <-> L2 Token pair for bridging.
     * @param l1Token Address of the canonical L1 token. This is the token users will receive on Ethereum.
     * @param l2Token Address of the L2 token representation. This is the token users would deposit on optimism.
     * @param l1BridgePool Address of the L1 withdrawal pool linked to this L2+L1 token.
     */
    function _whitelistToken(
        address l1Token,
        address l2Token,
        address l1BridgePool
    ) internal {
        whitelistedTokens[l2Token] = L2TokenRelationships({
            l1Token: l1Token,
            l1BridgePool: l1BridgePool,
            lastBridgeTime: uint64(getCurrentTime()),
            depositsEnabled: true
        });

        emit WhitelistToken(l1Token, l2Token, uint64(getCurrentTime()), l1BridgePool);
    }

    /**
     * @notice L1 owner can enable/disable deposits for a whitelisted token.
     * @param l2Token address of L2 token to enable/disable deposits for.
     * @param depositsEnabled bool to set if the deposit box should accept/reject deposits.
     */
    function _setEnableDeposits(address l2Token, bool depositsEnabled) internal {
        whitelistedTokens[l2Token].depositsEnabled = depositsEnabled;
        emit DepositsEnabled(l2Token, depositsEnabled);
    }

    function bridgeTokens(address l2Token, uint32 l2Gas) public virtual;

    /**************************************
     *         DEPOSITOR FUNCTIONS        *
     **************************************/

    /**
     * @notice Called by L2 user to bridge funds between L2 and L1.
     * @dev Emits the `FundsDeposited` event which relayers listen for as part of the bridging action.
     * @dev The caller must first approve this contract to spend `amount` of `l2Token`.
     * @param l1Recipient L1 address that should receive the tokens.
     * @param l2Token L2 token to deposit.
     * @param amount How many L2 tokens should be deposited.
     * @param slowRelayFeePct Max fraction of `amount` that the depositor is willing to pay as a slow relay fee.
     * @param instantRelayFeePct Fraction of `amount` that the depositor is willing to pay as an instant relay fee.
     * @param quoteTimestamp Timestamp, at which the depositor will be quoted for L1 liquidity. This enables the
     *    depositor to know the L1 fees before submitting their deposit. Must be within 10 mins of the current time.
     */
    function deposit(
        address l1Recipient,
        address l2Token,
        uint256 amount,
        uint64 slowRelayFeePct,
        uint64 instantRelayFeePct,
        uint64 quoteTimestamp
    ) public payable onlyIfDepositsEnabled(l2Token) nonReentrant() {
        require(isWhitelistToken(l2Token), "deposit token not whitelisted");
        // We limit the sum of slow and instant relay fees to 50% to prevent the user spending all their funds on fees.
        // The realizedLPFeePct on L1 is limited to 50% so the total spent on fees does not ever exceed 100%.
        require(slowRelayFeePct <= 0.25e18, "slowRelayFeePct must be <= 25%");
        require(instantRelayFeePct <= 0.25e18, "instantRelayFeePct must be <= 25%");

        // Note that the OVM's notion of `block.timestamp` is different to the main ethereum L1 EVM. The OVM timestamp
        // corresponds to the L1 timestamp of the last confirmed L1 ⇒ L2 transaction. The quoteTime must be within 10
        // mins of the current time to allow for this variance.
        // Note also that `quoteTimestamp` cannot be less than 10 minutes otherwise the following arithmetic can result
        // in underflow. This isn't a problem as the deposit will revert, but the error might be unexpected for clients.
        // Consider requiring `quoteTimestamp >= 10 minutes`.
        require(
            getCurrentTime() >= quoteTimestamp - 10 minutes && getCurrentTime() <= quoteTimestamp + 10 minutes,
            "deposit mined after deadline"
        );
        // If the address of the L1 token is the l1Weth and there is a msg.value with the transaction then the user
        // is sending ETH. In this case, the ETH should be deposited to WETH, which is then bridged to L1.
        if (whitelistedTokens[l2Token].l1Token == l1Weth && msg.value > 0) {
            require(msg.value == amount, "msg.value must match amount");
            WETH9Like(address(l2Token)).deposit{ value: msg.value }();
        }
        // Else, it is a normal ERC20. In this case pull the token from the users wallet as per normal.
        // Note: this includes the case where the L2 user has WETH (already wrapped ETH) and wants to bridge them. In
        // this case the msg.value will be set to 0, indicating a "normal" ERC20 bridging action.
        else IERC20(l2Token).safeTransferFrom(msg.sender, address(this), amount);

        emit FundsDeposited(
            chainId,
            numberOfDeposits, // depositId: the current number of deposits acts as a deposit ID (nonce).
            l1Recipient,
            msg.sender,
            whitelistedTokens[l2Token].l1Token,
            l2Token,
            amount,
            slowRelayFeePct,
            instantRelayFeePct,
            quoteTimestamp
        );

        numberOfDeposits += 1;
    }

    /**************************************
     *           VIEW FUNCTIONS           *
     **************************************/

    /**
     * @notice Checks if a given L2 token is whitelisted.
     * @dev Check the whitelisted token's `lastBridgeTime` parameter since its guaranteed to be != 0 once
     * the token has been whitelisted.
     * @param l2Token L2 token to check against the whitelist.
     * @return true if token is whitelised.
     */
    function isWhitelistToken(address l2Token) public view returns (bool) {
        return whitelistedTokens[l2Token].lastBridgeTime != 0;
    }

    function _hasEnoughTimeElapsedToBridge(address l2Token) internal view returns (bool) {
        return getCurrentTime() > whitelistedTokens[l2Token].lastBridgeTime + minimumBridgingDelay;
    }

    /**
     * @notice Designed to be called by implementing contract in `bridgeTokens` method which sends this contract's
     * balance of tokens from L2 to L1 via the canonical token bridge. Tokens that can be bridged are whitelisted
     * and have had enough time elapsed since the latest bridge (or the time at which at was whitelisted).
     * @dev This function is also public for caller convenience.
     * @param l2Token L2 token to check bridging status.
     * @return true if token is whitelised and enough time has elapsed since the previous bridge.
     */
    function canBridge(address l2Token) public view returns (bool) {
        return isWhitelistToken(l2Token) && _hasEnoughTimeElapsedToBridge(l2Token);
    }
}
