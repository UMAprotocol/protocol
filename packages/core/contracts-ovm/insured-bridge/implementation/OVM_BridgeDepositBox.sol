// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.7.6;

import "../external/OVM_Testable.sol"; //TODO: replace this with the normal UMA Testable once we can use 0.8 solidity.

import { OVM_CrossDomainEnabled } from "@eth-optimism/contracts/libraries/bridge/OVM_CrossDomainEnabled.sol";
import { Lib_PredeployAddresses } from "@eth-optimism/contracts/libraries/constants/Lib_PredeployAddresses.sol";

// Define some interfaces and helper libraries. This is temporary until we can bump the solidity version in these
// contracts to 0.8.x and import the rest of these libs from other UMA contracts in the repo.
library TokenHelper {
    function safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 value
    ) internal {
        // bytes4(keccak256(bytes('transferFrom(address,address,uint256)')));
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, value));
        require(
            success && (data.length == 0 || abi.decode(data, (bool))),
            "TokenHelper::transferFrom: transferFrom failed"
        );
    }
}

interface TokenLike {
    function balanceOf(address guy) external returns (uint256 wad);
}

interface StandardBridgeLike {
    function withdrawTo(
        address _l2Token,
        address _to,
        uint256 _amount,
        uint32 _l1Gas,
        bytes calldata _data
    ) external;
}

/**
 * @title OVM Bridge Deposit Box.
 * @notice Accepts deposits on Optimism L2 to relay to Ethereum L1 as part of the UMA insured bridge system.
 */

contract OVM_BridgeDepositBox is OVM_CrossDomainEnabled, OVM_Testable {
    /*************************************
     *  OVM DEPOSIT BOX DATA STRUCTURES  *
     *************************************/

    // Address of the L1 contract that acts as the owner of this Bridge deposit box.
    address public bridgeAdmin;

    // Track the total number of deposits. Used as a unique identifier for bridged transfers.
    uint256 public numberOfDeposits;

    struct L2TokenRelationships {
        address l1Token;
        address l1BridgePool;
        uint64 lastBridgeTime;
        bool depositsEnabled;
    }

    // Mapping of whitelisted L2Token to L2TokenRelationships. Contains L1 TokenAddress and the last time this token
    // type was bridged. Used to rate limit bridging actions to prevent DOS on L1.
    mapping(address => L2TokenRelationships) public whitelistedTokens;

    // Minimum time that must elapse between bridging actions for a given token. Used to rate limit bridging back to L1.
    uint64 public minimumBridgingDelay;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event SetBridgeAdmin(address newBridgeAdmin);
    event SetMinimumBridgingDelay(uint64 newMinimumBridgingDelay);
    event WhitelistToken(address l1Token, address l2Token, uint64 lastBridgeTime, address bridgePool);
    event DepositsEnabled(address l2Token, bool depositsEnabled);
    event FundsDeposited(
        uint256 depositId,
        uint256 timestamp,
        address sender,
        address recipient,
        address l1Token,
        uint256 amount,
        uint64 slowRelayFeePct,
        uint64 instantRelayFeePct,
        uint64 quoteTimestamp
    );
    event TokensBridged(address l2Token, uint256 numberOfTokensBridged, uint256 l1Gas, address caller);

    /****************************************
     *               MODIFIERS              *
     ****************************************/

    modifier onlyIfDepositsEnabled(address _l2Token) {
        require(whitelistedTokens[_l2Token].depositsEnabled, "Contract is disabled");
        _;
    }

    /**
     * @notice Construct the OVM Bridge Deposit Box
     * @param _bridgeAdmin Address of the cross-chain administrator on L1. This contract deploys new BridgePool
     *    contracts that facilitate withdrawals, and can call permissioned functions on this contract.
     * @param _minimumBridgingDelay Minimum second that must elapse between L2->L1 token transfer to prevent dos.
     * @param timerAddress Timer used to synchronize contract time in testing. Set to 0x000... in production.
     */
    constructor(
        address _bridgeAdmin,
        uint64 _minimumBridgingDelay,
        address timerAddress
    ) OVM_CrossDomainEnabled(Lib_PredeployAddresses.L2_CROSS_DOMAIN_MESSENGER) OVM_Testable(timerAddress) {
        require(_bridgeAdmin != address(0), "Bad bridge admin address");
        _setBridgeAdmin(_bridgeAdmin);
        _setMinimumBridgingDelay(_minimumBridgingDelay);
    }

    /**************************************
     *          ADMIN FUNCTIONS           *
     **************************************/

    /**
     * @notice Changes the L1 administrator associated with this L2 deposit deposit box.
     * @dev Only callable by the existing bridgeAdmin via the optimism cross domain messenger.
     * @param _bridgeAdmin address of the new L1 admin contract.
     */
    function setBridgeAdmin(address _bridgeAdmin) public onlyFromCrossDomainAccount(bridgeAdmin) {
        _setBridgeAdmin(_bridgeAdmin);
    }

    /**
     * @notice Changes the minimum time in seconds that must elapse between withdraws from L2->L1.
     * @dev Only callable by the existing bridgeAdmin via the optimism cross domain messenger.
     * @param _minimumBridgingDelay the new minimum delay.
     */
    function setMinimumBridgingDelay(uint64 _minimumBridgingDelay) public onlyFromCrossDomainAccount(bridgeAdmin) {
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
    ) public onlyFromCrossDomainAccount(bridgeAdmin) {
        whitelistedTokens[l2Token] = L2TokenRelationships({
            l1Token: l1Token,
            l1BridgePool: l1BridgePool,
            lastBridgeTime: uint64(getCurrentTime()),
            depositsEnabled: true
        });

        emit WhitelistToken(l1Token, l2Token, uint64(getCurrentTime()), l1BridgePool);
    }

    /**
     * @notice L1 owner can enable/disable deposits for a whitelisted tokens.
     * @dev Only callable by the existing bridgeAdmin via the optimism cross domain messenger.
     * @param _l2Token address of L2 token to enable/disable deposits for.
     * @param _depositsEnabled bool to set if the deposit box should accept/reject deposits.
     */
    function setEnableDeposits(address _l2Token, bool _depositsEnabled) public onlyFromCrossDomainAccount(bridgeAdmin) {
        whitelistedTokens[_l2Token].depositsEnabled = _depositsEnabled;
        emit DepositsEnabled(_l2Token, _depositsEnabled);
    }

    /**************************************
     *         DEPOSITOR FUNCTIONS        *
     **************************************/

    /**
     * @notice Called by L2 user to bridge funds between L2 and L1.
     * @dev Emits the `FundsDeposited` event which relayers listen for as part of the bridging action.
     * @dev The caller must first approve this contract to spend `amount` of `l2Token`.
     * @param recipient L1 address that should receive the tokens.
     * @param l2Token L2 token to deposit.
     * @param amount How many L2 tokens should be deposited.
     * @param slowRelayFeePct Max fraction of `amount` that the depositor is willing to pay as a slow relay fee.
     * @param instantRelayFeePct Fraction of `amount` that the depositor is willing to pay as a instant relay fee.
     * @param quoteTimestamp Timestamp, at which the depositor will be quoted for L1 liquidity. This enables the
     *    depositor to know the L1 fees before submitting their deposit. Must be within 10 mins of the current time.
     */
    function deposit(
        address recipient,
        address l2Token,
        uint256 amount,
        uint64 slowRelayFeePct,
        uint64 instantRelayFeePct,
        uint64 quoteTimestamp
    ) public onlyIfDepositsEnabled(l2Token) {
        require(isWhitelistToken(l2Token), "deposit token not whitelisted");
        // We limit the sum of slow and instant relay fees to 50% to prevent the user spending all their funds on fees.
        // The realizedLPFeePct on L1 is limited to 50% so the total spent on fees does not ever exceed 100%.
        require(slowRelayFeePct <= 0.25e18, "slowRelayFeePct can not exceed 25%");
        require(instantRelayFeePct <= 0.25e18, "instantRelayFeePct can not exceed 25%");

        // Note that the OVM's notion of `block.timestamp` is different to the main ethereum L1 EVM. The OVM timestamp
        // corresponds to the L1 timestamp of the last confirmed L1 ⇒ L2 transaction. The quoteTime must be within 10
        // mins of the current time to allow for this variance.
        require(
            getCurrentTime() >= quoteTimestamp - 10 minutes && getCurrentTime() <= quoteTimestamp + 10 minutes,
            "deposit mined after deadline"
        );

        emit FundsDeposited(
            numberOfDeposits, // the current number of deposits acts as a deposit ID (nonce).
            getCurrentTime(),
            msg.sender,
            recipient,
            whitelistedTokens[l2Token].l1Token,
            amount,
            slowRelayFeePct,
            instantRelayFeePct,
            quoteTimestamp
        );

        numberOfDeposits += 1;

        TokenHelper.safeTransferFrom(l2Token, msg.sender, address(this), amount);
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
    function bridgeTokens(address l2Token, uint32 l1Gas) public {
        uint256 bridgeDepositBoxBalance = TokenLike(l2Token).balanceOf(address(this));
        require(bridgeDepositBoxBalance > 0, "can't bridge zero tokens");
        require(isWhitelistToken(l2Token), "can't bridge non-whitelisted token");
        require(hasEnoughTimeElapsedToBridge(l2Token), "not enough time has elapsed from previous bridge");

        whitelistedTokens[l2Token].lastBridgeTime = uint64(getCurrentTime());

        StandardBridgeLike(Lib_PredeployAddresses.L2_STANDARD_BRIDGE).withdrawTo(
            l2Token, // _l2Token. Address of the L2 token to bridge over.
            whitelistedTokens[l2Token].l1BridgePool, // _to. Withdraw, over the bridge, to the l1 withdraw contract.
            bridgeDepositBoxBalance, // _amount. Send the full balance of the deposit box to bridge.
            l1Gas, // _l1Gas. Unused, but included for potential forward compatibility considerations
            "0x" // _data. TODO: add additional info into this data prop this.
        );

        emit TokensBridged(l2Token, bridgeDepositBoxBalance, l1Gas, msg.sender);
    }

    /**************************************
     *           VIEW FUNCTIONS           *
     **************************************/

    /**
     * @notice Checks if a given L2 token is whitelisted.
     * @param l2Token L2 token to check against the whitelist.
     */
    function isWhitelistToken(address l2Token) public view returns (bool) {
        return whitelistedTokens[l2Token].l1Token != address(0);
    }

    /**
     * @notice Checks if enough time has elapsed from the previous bridge transfer to execute another bridge transfer.
     * @param l2Token L2 token to check against last bridge time delay.
     */
    function hasEnoughTimeElapsedToBridge(address l2Token) public view returns (bool) {
        return getCurrentTime() > whitelistedTokens[l2Token].lastBridgeTime + minimumBridgingDelay;
    }

    /**************************************
     *        INTERNAL FUNCTIONS          *
     **************************************/

    function _setBridgeAdmin(address _l1BridgeAdmin) internal {
        require(_l1BridgeAdmin != address(0), "Bad bridge router address");
        bridgeAdmin = _l1BridgeAdmin;
        emit SetBridgeAdmin(bridgeAdmin);
    }

    function _setMinimumBridgingDelay(uint64 _MinimumBridgingDelay) internal {
        minimumBridgingDelay = _MinimumBridgingDelay;
        emit SetMinimumBridgingDelay(minimumBridgingDelay);
    }
}
