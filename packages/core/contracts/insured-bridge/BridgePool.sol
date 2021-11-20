// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./interfaces/BridgeAdminInterface.sol";
import "./interfaces/BridgePoolInterface.sol";

import "../oracle/interfaces/SkinnyOptimisticOracleInterface.sol";
import "../oracle/interfaces/StoreInterface.sol";
import "../oracle/interfaces/FinderInterface.sol";
import "../oracle/implementation/Constants.sol";

import "../common/implementation/AncillaryData.sol";
import "../common/implementation/Testable.sol";
import "../common/implementation/FixedPoint.sol";
import "../common/implementation/Lockable.sol";
import "../common/implementation/MultiCaller.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

interface WETH9Like {
    function withdraw(uint256 wad) external;

    function deposit() external payable;
}

/**
 * @notice Contract deployed on L1 that provides methods for "Relayers" to fulfill deposit orders that originated on L2.
 * The Relayers can either post capital to fulfill the deposit (instant relay), or request that the funds are taken out
 * of a passive liquidity provider pool following a challenge period (slow relay). This contract ingests liquidity from
 * passive liquidity providers and returns them claims to withdraw their funds. Liquidity providers are incentivized
 * to post collateral by earning a fee per fulfilled deposit order.
 * @dev A "Deposit" is an order to send capital from L2 to L1, and a "Relay" is a fulfillment attempt of that order.
 */
contract BridgePool is MultiCaller, Testable, BridgePoolInterface, ERC20, Lockable {
    using SafeERC20 for IERC20;
    using FixedPoint for FixedPoint.Unsigned;
    using Address for address;

    // Token that this contract receives as LP deposits.
    IERC20 public override l1Token;

    // Track the total number of relays and uniquely identifies relays.
    uint32 public numberOfRelays;

    // Reserves that are unutilized and withdrawable.
    uint256 public liquidReserves;

    // Reserves currently utilized due to L2-L1 transactions in flight.
    int256 public utilizedReserves;

    // Reserves that are not yet utilized but are pre-allocated for a pending relay.
    uint256 public pendingReserves;

    // True If this pool stores WETH. If the withdrawn token is WETH then unwrap and send ETH when finalizing
    // relays. Also enable LPs to receive ETH, if they choose, when withdrawing liquidity.
    bool public isWethPool;

    // Enables the Bridge Admin to enable/disable relays in this pool. Disables relayDeposit and relayAndSpeedUp.
    bool public relaysEnabled = true;

    // Exponential decay exchange rate to accumulate fees to LPs over time. This can be changed via the BridgeAdmin.
    uint64 public lpFeeRatePerSecond;

    // Last timestamp that LP fees were updated.
    uint32 public lastLpFeeUpdate;

    // Store local instances of contract params to save gas relaying.
    uint64 public proposerBondPct;
    uint32 public optimisticOracleLiveness;

    // Store local instance of the reserve currency final fee. This is a gas optimization to not re-call the store.
    uint256 l1TokenFinalFee;

    // Cumulative undistributed LP fees. As fees accumulate, they are subtracted from this number.
    uint256 public undistributedLpFees;

    // Total bond amount held for pending relays. Bonds are released following a successful relay or after a dispute.
    uint256 public bonds;

    // Administrative contract that deployed this contract and also houses all state variables needed to relay deposits.
    BridgeAdminInterface public bridgeAdmin;

    // Store local instances of the contract instances to save gas relaying. Can be sync with the Finder at any time via
    // the syncUmaEcosystemParams() public function.
    StoreInterface public store;
    SkinnyOptimisticOracleInterface public optimisticOracle;

    // DVM price request identifier that is resolved based on the validity of a relay attempt.
    bytes32 public identifier;

    // A Relay represents an attempt to finalize a cross-chain transfer that originated on an L2 DepositBox contract.
    // The flow chart between states is as follows:
    // - Begin at Uninitialized.
    // - When relayDeposit() is called, a new relay is created with state Pending and mapped to the L2 deposit hash.
    // - If the relay is disputed, the RelayData gets deleted and the L2 deposit hash has no relay mapped to it anymore.
    // - The above statements enable state to transfer between the Uninitialized and Pending states.
    // - When settleRelay() is successfully called, the relay state gets set to Finalized and cannot change from there.
    // - It is impossible for a relay to be deleted when in Finalized state (and have its state set to Uninitialized)
    //   because the only way for settleRelay() to succeed is if the price has resolved on the OptimisticOracle.
    // - You cannot dispute an already resolved request on the OptimisticOracle. Moreover, the mapping from
    //   a relay's ancillary data hash to its deposit hash is deleted after a successful settleRelay() call.
    enum RelayState { Uninitialized, Pending, Finalized }

    // Data from L2 deposit transaction.
    struct DepositData {
        uint256 chainId;
        uint64 depositId;
        address payable l1Recipient;
        address l2Sender;
        uint256 amount;
        uint64 slowRelayFeePct;
        uint64 instantRelayFeePct;
        uint32 quoteTimestamp;
    }

    // Each L2 Deposit can have one Relay attempt at any one time. A Relay attempt is characterized by its RelayData.
    struct RelayData {
        RelayState relayState;
        address slowRelayer;
        uint32 relayId;
        uint64 realizedLpFeePct;
        uint32 priceRequestTime;
        uint256 proposerBond;
        uint256 finalFee;
    }

    // Associate deposits with pending relay data. When the mapped relay hash is empty, new relay attempts can be made
    // for this deposit. The relay data contains information necessary to pay out relayers on successful relay.
    // Relay hashes are deleted when they are disputed on the OptimisticOracle.
    mapping(bytes32 => bytes32) public relays;

    // Map hash of deposit and realized-relay fee to instant relayers. This mapping is checked at settlement time
    // to determine if there was a valid instant relayer.
    mapping(bytes32 => address) public instantRelays;

    event LiquidityAdded(uint256 amount, uint256 lpTokensMinted, address indexed liquidityProvider);
    event LiquidityRemoved(uint256 amount, uint256 lpTokensBurnt, address indexed liquidityProvider);
    event DepositRelayed(
        bytes32 indexed depositHash,
        DepositData depositData,
        RelayData relay,
        bytes32 relayAncillaryDataHash
    );
    event RelaySpedUp(bytes32 indexed depositHash, address indexed instantRelayer, RelayData relay);

    // Note: the difference between a dispute and a cancellation is that a cancellation happens in the case where
    // something changes in the OO between request and dispute that causes calls to it to fail. The most common
    // case would be an increase in final fee. However, things like whitelisting can also cause problems.
    event RelayDisputed(bytes32 indexed depositHash, bytes32 indexed relayHash, address indexed disputer);
    event RelayCanceled(bytes32 indexed depositHash, bytes32 indexed relayHash, address indexed disputer);
    event RelaySettled(bytes32 indexed depositHash, address indexed caller, RelayData relay);
    event BridgePoolAdminTransferred(address oldAdmin, address newAdmin);
    event RelaysEnabledSet(bool newRelaysEnabled);
    event LpFeeRateSet(uint64 newLpFeeRatePerSecond);

    modifier onlyBridgeAdmin() {
        require(msg.sender == address(bridgeAdmin), "Caller not bridge admin");
        _;
    }

    modifier onlyIfRelaysEnabld() {
        require(relaysEnabled, "Relays are disabled");
        _;
    }

    /**
     * @notice Construct the Bridge Pool.
     * @param _lpTokenName Name of the LP token to be deployed by this contract.
     * @param _lpTokenSymbol Symbol of the LP token to be deployed by this contract.
     * @param _bridgeAdmin Admin contract deployed alongside on L1. Stores global variables and has owner control.
     * @param _l1Token Address of the L1 token that this bridgePool holds. This is the token LPs deposit and is bridged.
     * @param _lpFeeRatePerSecond Interest rate payment that scales the amount of pending fees per second paid to LPs.
     * @param _isWethPool Toggles if this is the WETH pool. If it is then can accept ETH and wrap to WETH for the user.
     * @param _timer Timer used to synchronize contract time in testing. Set to 0x000... in production.
     */
    constructor(
        string memory _lpTokenName,
        string memory _lpTokenSymbol,
        address _bridgeAdmin,
        address _l1Token,
        uint64 _lpFeeRatePerSecond,
        bool _isWethPool,
        address _timer
    ) Testable(_timer) ERC20(_lpTokenName, _lpTokenSymbol) {
        require(bytes(_lpTokenName).length != 0 && bytes(_lpTokenSymbol).length != 0, "Bad LP token name or symbol");
        bridgeAdmin = BridgeAdminInterface(_bridgeAdmin);
        l1Token = IERC20(_l1Token);
        lastLpFeeUpdate = uint32(getCurrentTime());
        lpFeeRatePerSecond = _lpFeeRatePerSecond;
        isWethPool = _isWethPool;

        syncUmaEcosystemParams(); // Fetch OptimisticOracle and Store addresses and L1Token finalFee.
        syncWithBridgeAdminParams(); // Fetch ProposerBondPct OptimisticOracleLiveness, Identifier from the BridgeAdmin.

        emit LpFeeRateSet(lpFeeRatePerSecond);
    }

    /*************************************************
     *          LIQUIDITY PROVIDER FUNCTIONS         *
     *************************************************/

    /**
     * @notice Add liquidity to the bridge pool. Pulls l1Token from the caller's wallet. The caller is sent back a
     * commensurate number of LP tokens (minted to their address) at the prevailing exchange rate.
     * @dev The caller must approve this contract to transfer `l1TokenAmount` amount of l1Token if depositing ERC20.
     * @dev The caller can deposit ETH which is auto wrapped to WETH. This can only be done if: a) this is the Weth pool
     * and b) the l1TokenAmount matches to the transaction msg.value.
     * @dev Reentrancy guard not added to this function because this indirectly calls sync() which is guarded.
     * @param l1TokenAmount Number of l1Token to add as liquidity.
     */
    function addLiquidity(uint256 l1TokenAmount) public payable nonReentrant() {
        // If this is the weth pool and the caller sends msg.value then the msg.value must match the l1TokenAmount.
        // Else, msg.value must be set to 0.
        require((isWethPool && msg.value == l1TokenAmount) || msg.value == 0, "Bad add liquidity Eth value");

        // Since `exchangeRateCurrent()` reads this contract's balance and updates contract state using it,
        // we must call it first before transferring any tokens to this contract.
        uint256 lpTokensToMint = (l1TokenAmount * 1e18) / _exchangeRateCurrent();
        _mint(msg.sender, lpTokensToMint);
        liquidReserves += l1TokenAmount;

        if (msg.value > 0 && isWethPool) WETH9Like(address(l1Token)).deposit{ value: msg.value }();
        else l1Token.safeTransferFrom(msg.sender, address(this), l1TokenAmount);

        emit LiquidityAdded(l1TokenAmount, lpTokensToMint, msg.sender);
    }

    /**
     * @notice Removes liquidity from the bridge pool. Burns lpTokenAmount LP tokens from the caller's wallet. The caller
     * is sent back a commensurate number of l1Tokens at the prevailing exchange rate.
     * @dev The caller does not need to approve the spending of LP tokens as this method directly uses the burn logic.
     * @dev Reentrancy guard not added to this function because this indirectly calls sync() which is guarded.
     * @param lpTokenAmount Number of lpTokens to redeem for underlying.
     * @param sendEth Enable the liquidity provider to remove liquidity in ETH, if this is the WETH pool.
     */
    function removeLiquidity(uint256 lpTokenAmount, bool sendEth) public nonReentrant() {
        // Can only send eth on withdrawing liquidity iff this is the WETH pool.
        require(!sendEth || isWethPool, "Cant send eth");
        uint256 l1TokensToReturn = (lpTokenAmount * _exchangeRateCurrent()) / 1e18;

        // Check that there is enough liquid reserves to withdraw the requested amount.
        require(liquidReserves >= (pendingReserves + l1TokensToReturn), "Utilization too high to remove");

        _burn(msg.sender, lpTokenAmount);
        liquidReserves -= l1TokensToReturn;

        if (sendEth) _unwrapWETHTo(payable(msg.sender), l1TokensToReturn);
        else l1Token.safeTransfer(msg.sender, l1TokensToReturn);

        emit LiquidityRemoved(l1TokensToReturn, lpTokenAmount, msg.sender);
    }

    /**************************************
     *          RELAYER FUNCTIONS         *
     **************************************/

    /**
     * @notice Called by Relayer to execute a slow + fast relay from L2 to L1, fulfilling a corresponding deposit order.
     * @dev There can only be one pending relay for a deposit. This method is effectively the relayDeposit and
     * speedUpRelay methods concatenated. This could be refactored to just call each method, but there
     * are some gas savings in combining the transfers and hash computations.
     * @dev Caller must have approved this contract to spend the total bond + amount - fees for `l1Token`.
     * @dev This function can only be called if relays are enabled for this bridge pool.
     * @param depositData the deposit data struct containing all the user's deposit information.
     * @param realizedLpFeePct LP fee calculated off-chain considering the L1 pool liquidity at deposit time, before
     *      quoteTimestamp. The OO acts to verify the correctness of this realized fee. Cannot exceed 50%.
     */
    function relayAndSpeedUp(DepositData memory depositData, uint64 realizedLpFeePct)
        public
        onlyIfRelaysEnabld()
        nonReentrant()
    {
        // If no pending relay for this deposit, then associate the caller's relay attempt with it.
        uint32 priceRequestTime = uint32(getCurrentTime());

        // The realizedLPFeePct should never be greater than 0.5e18 and the slow and instant relay fees should never be
        // more than 0.25e18 each. Therefore, the sum of all fee types can never exceed 1e18 (or 100%).
        require(
            depositData.slowRelayFeePct <= 0.25e18 &&
                depositData.instantRelayFeePct <= 0.25e18 &&
                realizedLpFeePct <= 0.5e18,
            "Invalid fees"
        );

        // Check if there is a pending relay for this deposit.
        bytes32 depositHash = _getDepositHash(depositData);

        // Note: A disputed relay deletes the stored relay hash and enables this require statement to pass.
        require(relays[depositHash] == bytes32(0), "Pending relay exists");

        uint256 proposerBond = _getProposerBond(depositData.amount);

        // Save hash of new relay attempt parameters.
        // Note: The liveness for this relay can be changed in the BridgeAdmin, which means that each relay has a
        // potentially variable liveness time. This should not provide any exploit opportunities, especially because
        // the BridgeAdmin state (including the liveness value) is permissioned to the cross domained owner.
        RelayData memory relayData =
            RelayData({
                relayState: RelayState.Pending,
                slowRelayer: msg.sender,
                relayId: numberOfRelays++, // Note: Increment numberOfRelays at the same time as setting relayId to its current value.
                realizedLpFeePct: realizedLpFeePct,
                priceRequestTime: priceRequestTime,
                proposerBond: proposerBond,
                finalFee: l1TokenFinalFee
            });
        bytes32 relayHash = _getRelayHash(depositData, relayData);
        relays[depositHash] = _getRelayDataHash(relayData);

        bytes32 instantRelayHash = _getInstantRelayHash(depositHash, relayData);
        require(
            // Can only speed up a pending relay without an existing instant relay associated with it.
            instantRelays[instantRelayHash] == address(0),
            "Relay cannot be sped up"
        );

        // Sanity check that pool has enough balance to cover relay amount + proposer reward. Reward amount will be
        // paid on settlement after the OptimisticOracle price request has passed the challenge period.
        // Note: liquidReserves should always be <= balance - bonds.
        require(liquidReserves - pendingReserves >= depositData.amount, "Insufficient pool balance");

        // Compute total proposal bond and pull from caller so that the OptimisticOracle can pull it from here.
        uint256 totalBond = proposerBond + l1TokenFinalFee;

        // Pull relay amount minus fees from caller and send to the deposit l1Recipient. The total fees paid is the sum
        // of the LP fees, the relayer fees and the instant relay fee.
        uint256 feesTotal =
            _getAmountFromPct(
                relayData.realizedLpFeePct + depositData.slowRelayFeePct + depositData.instantRelayFeePct,
                depositData.amount
            );
        // If the L1 token is WETH then: a) pull WETH from instant relayer b) unwrap WETH c) send ETH to recipient.
        uint256 recipientAmount = depositData.amount - feesTotal;

        bonds += totalBond;
        pendingReserves += depositData.amount; // Book off maximum liquidity used by this relay in the pending reserves.

        instantRelays[instantRelayHash] = msg.sender;

        l1Token.safeTransferFrom(msg.sender, address(this), recipientAmount + totalBond);

        // If this is a weth pool then unwrap and send eth.
        if (isWethPool) {
            _unwrapWETHTo(depositData.l1Recipient, recipientAmount);
            // Else, this is a normal ERC20 token. Send to recipient.
        } else l1Token.safeTransfer(depositData.l1Recipient, recipientAmount);

        emit DepositRelayed(depositHash, depositData, relayData, relayHash);
        emit RelaySpedUp(depositHash, msg.sender, relayData);
    }

    /**
     * @notice Called by Disputer to dispute an ongoing relay.
     * @dev The result of this method is to always throw out the relay, providing an opportunity for another relay for
     * the same deposit. Between the disputer and proposer, whoever is incorrect loses their bond. Whoever is correct
     * gets it back + a payout.
     * @dev Caller must have approved this contract to spend the total bond + amount - fees for `l1Token`.
     * @param depositData the deposit data struct containing all the user's deposit information.
     * @param relayData RelayData logged in the disputed relay.
     */
    function disputeRelay(DepositData memory depositData, RelayData memory relayData) public nonReentrant() {
        require(relayData.priceRequestTime + optimisticOracleLiveness > getCurrentTime(), "Past liveness");
        require(relayData.relayState == RelayState.Pending, "Not disputable");
        // Validate the input data.
        bytes32 depositHash = _getDepositHash(depositData);
        _validateRelayDataHash(depositHash, relayData);

        // Submit the proposal and dispute to the OO.
        bytes32 relayHash = _getRelayHash(depositData, relayData);

        // Note: in some cases this will fail due to changes in the OO and the method will refund the relayer.
        bool success =
            _requestProposeDispute(
                relayData.slowRelayer,
                msg.sender,
                relayData.proposerBond,
                relayData.finalFee,
                _getRelayAncillaryData(relayHash)
            );

        // Drop the relay and remove the bond from the tracked bonds.
        bonds -= relayData.finalFee + relayData.proposerBond;
        pendingReserves -= depositData.amount;
        delete relays[depositHash];
        if (success) emit RelayDisputed(depositHash, _getRelayDataHash(relayData), msg.sender);
        else emit RelayCanceled(depositHash, _getRelayDataHash(relayData), msg.sender);
    }

    /**
     * @notice Called by Relayer to execute a slow relay from L2 to L1, fulfilling a corresponding deposit order.
     * @dev There can only be one pending relay for a deposit.
     * @dev Caller must have approved this contract to spend the total bond + amount - fees for `l1Token`.
     * @dev This function can only be called if relays are enabled for this bridge pool.
     * @param depositData the deposit data struct containing all the user's deposit information.
     * @param realizedLpFeePct LP fee calculated off-chain considering the L1 pool liquidity at deposit time, before
     *      quoteTimestamp. The OO acts to verify the correctness of this realized fee. Cannot exceed 50%.
     */
    function relayDeposit(DepositData memory depositData, uint64 realizedLpFeePct)
        public
        onlyIfRelaysEnabld()
        nonReentrant()
    {
        // The realizedLPFeePct should never be greater than 0.5e18 and the slow and instant relay fees should never be
        // more than 0.25e18 each. Therefore, the sum of all fee types can never exceed 1e18 (or 100%).
        require(
            depositData.slowRelayFeePct <= 0.25e18 &&
                depositData.instantRelayFeePct <= 0.25e18 &&
                realizedLpFeePct <= 0.5e18,
            "Invalid fees"
        );

        // Check if there is a pending relay for this deposit.
        bytes32 depositHash = _getDepositHash(depositData);

        // Note: A disputed relay deletes the stored relay hash and enables this require statement to pass.
        require(relays[depositHash] == bytes32(0), "Pending relay exists");

        // If no pending relay for this deposit, then associate the caller's relay attempt with it.
        uint32 priceRequestTime = uint32(getCurrentTime());

        uint256 proposerBond = _getProposerBond(depositData.amount);

        // Save hash of new relay attempt parameters.
        // Note: The liveness for this relay can be changed in the BridgeAdmin, which means that each relay has a
        // potentially variable liveness time. This should not provide any exploit opportunities, especially because
        // the BridgeAdmin state (including the liveness value) is permissioned to the cross domained owner.
        RelayData memory relayData =
            RelayData({
                relayState: RelayState.Pending,
                slowRelayer: msg.sender,
                relayId: numberOfRelays++, // Note: Increment numberOfRelays at the same time as setting relayId to its current value.
                realizedLpFeePct: realizedLpFeePct,
                priceRequestTime: priceRequestTime,
                proposerBond: proposerBond,
                finalFee: l1TokenFinalFee
            });
        relays[depositHash] = _getRelayDataHash(relayData);

        bytes32 relayHash = _getRelayHash(depositData, relayData);

        // Sanity check that pool has enough balance to cover relay amount + proposer reward. Reward amount will be
        // paid on settlement after the OptimisticOracle price request has passed the challenge period.
        // Note: liquidReserves should always be <= balance - bonds.
        require(liquidReserves - pendingReserves >= depositData.amount, "Insufficient pool balance");

        // Compute total proposal bond and pull from caller so that the OptimisticOracle can pull it from here.
        uint256 totalBond = proposerBond + l1TokenFinalFee;
        pendingReserves += depositData.amount; // Book off maximum liquidity used by this relay in the pending reserves.
        bonds += totalBond;

        l1Token.safeTransferFrom(msg.sender, address(this), totalBond);
        emit DepositRelayed(depositHash, depositData, relayData, relayHash);
    }

    /**
     * @notice Instantly relay a deposit amount minus fees to the l1Recipient. Instant relayer earns a reward following
     * the pending relay challenge period.
     * @dev We assume that the caller has performed an off-chain check that the deposit data they are attempting to
     * relay is valid. If the deposit data is invalid, then the instant relayer has no recourse to receive their funds
     * back after the invalid deposit data is disputed. Moreover, no one will be able to resubmit a relay for the
     * invalid deposit data because they know it will get disputed again. On the other hand, if the deposit data is
     * valid, then even if it is falsely disputed, the instant relayer will eventually get reimbursed because someone
     * else will be incentivized to resubmit the relay to earn slow relayer rewards. Once the valid relay is finalized,
     * the instant relayer will be reimbursed. Therefore, the caller has the same responsibility as the disputer in
     * validating the relay data.
     * @dev Caller must have approved this contract to spend the deposit amount of L1 tokens to relay. There can only
     * be one instant relayer per relay attempt. You cannot speed up a relay that is past liveness.
     * @param depositData Unique set of L2 deposit data that caller is trying to instantly relay.
     * @param relayData Parameters of Relay that caller is attempting to speedup. Must hash to the stored relay hash
     * for this deposit or this method will revert.
     */
    function speedUpRelay(DepositData memory depositData, RelayData memory relayData) public nonReentrant() {
        bytes32 depositHash = _getDepositHash(depositData);
        _validateRelayDataHash(depositHash, relayData);
        bytes32 instantRelayHash = _getInstantRelayHash(depositHash, relayData);
        require(
            // Can only speed up a pending relay without an existing instant relay associated with it.
            getCurrentTime() < relayData.priceRequestTime + optimisticOracleLiveness &&
                relayData.relayState == RelayState.Pending &&
                instantRelays[instantRelayHash] == address(0),
            "Relay cannot be sped up"
        );
        instantRelays[instantRelayHash] = msg.sender;

        // Pull relay amount minus fees from caller and send to the deposit l1Recipient. The total fees paid is the sum
        // of the LP fees, the relayer fees and the instant relay fee.
        uint256 feesTotal =
            _getAmountFromPct(
                relayData.realizedLpFeePct + depositData.slowRelayFeePct + depositData.instantRelayFeePct,
                depositData.amount
            );
        // If the L1 token is WETH then: a) pull WETH from instant relayer b) unwrap WETH c) send ETH to recipient.
        uint256 recipientAmount = depositData.amount - feesTotal;
        if (isWethPool) {
            l1Token.safeTransferFrom(msg.sender, address(this), recipientAmount);
            _unwrapWETHTo(depositData.l1Recipient, recipientAmount);
            // Else, this is a normal ERC20 token. Send to recipient.
        } else l1Token.safeTransferFrom(msg.sender, depositData.l1Recipient, recipientAmount);

        emit RelaySpedUp(depositHash, msg.sender, relayData);
    }

    /**
     * @notice Reward relayers if a pending relay price request has a price available on the OptimisticOracle. Mark
     * the relay as complete.
     * @dev We use the relayData and depositData to compute the ancillary data that the relay price request is uniquely
     * associated with on the OptimisticOracle. If the price request passed in does not match the pending relay price
     * request, then this will revert.
     * @param depositData Unique set of L2 deposit data that caller is trying to settle a relay for.
     * @param relayData Parameters of Relay that caller is attempting to settle. Must hash to the stored relay hash
     * for this deposit.
     */
    function settleRelay(DepositData memory depositData, RelayData memory relayData) public nonReentrant() {
        bytes32 depositHash = _getDepositHash(depositData);
        _validateRelayDataHash(depositHash, relayData);
        require(relayData.relayState == RelayState.Pending, "Already settled");
        uint32 expirationTime = relayData.priceRequestTime + optimisticOracleLiveness;
        require(expirationTime <= getCurrentTime(), "Not settleable yet");

        // Note: this check is to give the relayer a small, but reasonable amount of time to complete the relay before
        // before it can be "stolen" by someone else. This is to ensure there is an incentive to settle relays quickly.
        require(
            msg.sender == relayData.slowRelayer || getCurrentTime() > expirationTime + 15 minutes,
            "Not slow relayer"
        );

        // Update the relay state to Finalized. This prevents any re-settling of a relay.
        relays[depositHash] = _getRelayDataHash(
            RelayData({
                relayState: RelayState.Finalized,
                slowRelayer: relayData.slowRelayer,
                relayId: relayData.relayId,
                realizedLpFeePct: relayData.realizedLpFeePct,
                priceRequestTime: relayData.priceRequestTime,
                proposerBond: relayData.proposerBond,
                finalFee: relayData.finalFee
            })
        );

        // Reward relayers and pay out l1Recipient.
        // At this point there are two possible cases:
        // - This was a slow relay: In this case, a) pay the slow relayer their reward and b) pay the l1Recipient of the
        //      amount minus the realized LP fee and the slow Relay fee. The transfer was not sped up so no instant fee.
        // - This was an instant relay: In this case, a) pay the slow relayer their reward and b) pay the instant relayer
        //      the full bridging amount, minus the realized LP fee and minus the slow relay fee. When the instant
        //      relayer called speedUpRelay they were docked this same amount, minus the instant relayer fee. As a
        //      result, they are effectively paid what they spent when speeding up the relay + the instantRelayFee.

        uint256 instantRelayerOrRecipientAmount =
            depositData.amount -
                _getAmountFromPct(relayData.realizedLpFeePct + depositData.slowRelayFeePct, depositData.amount);

        // Refund the instant relayer iff the instant relay params match the approved relay.
        bytes32 instantRelayHash = _getInstantRelayHash(depositHash, relayData);
        address instantRelayer = instantRelays[instantRelayHash];

        // If this is the WETH pool and the instant relayer is is address 0x0 (i.e the relay was not sped up) then:
        // a) withdraw WETH to ETH and b) send the ETH to the recipient.
        if (isWethPool && instantRelayer == address(0)) {
            _unwrapWETHTo(depositData.l1Recipient, instantRelayerOrRecipientAmount);
            // Else, this is a normal slow relay being finalizes where the contract sends ERC20 to the recipient OR this
            // is the finalization of an instant relay where we need to reimburse the instant relayer in WETH.
        } else
            l1Token.safeTransfer(
                instantRelayer != address(0) ? instantRelayer : depositData.l1Recipient,
                instantRelayerOrRecipientAmount
            );

        // There is a fee and a bond to pay out. The fee goes to whoever settles. The bond always goes back to the
        // slow relayer.
        // Note: for gas efficiency, we use an if so we can combine these transfers in the event that they are the same
        // address.
        uint256 slowRelayerReward = _getAmountFromPct(depositData.slowRelayFeePct, depositData.amount);
        uint256 totalBond = relayData.finalFee + relayData.proposerBond;
        if (relayData.slowRelayer == msg.sender)
            l1Token.safeTransfer(relayData.slowRelayer, slowRelayerReward + totalBond);
        else {
            l1Token.safeTransfer(relayData.slowRelayer, totalBond);
            l1Token.safeTransfer(msg.sender, slowRelayerReward);
        }

        uint256 totalReservesSent = instantRelayerOrRecipientAmount + slowRelayerReward;

        // Update reserves by amounts changed and allocated LP fees.
        pendingReserves -= depositData.amount;
        liquidReserves -= totalReservesSent;
        utilizedReserves += int256(totalReservesSent);
        bonds -= totalBond;
        _updateAccumulatedLpFees();
        _allocateLpFees(_getAmountFromPct(relayData.realizedLpFeePct, depositData.amount));

        emit RelaySettled(depositHash, msg.sender, relayData);

        // Clean up state storage and receive gas refund. This also prevents `priceDisputed()` from being able to reset
        // this newly Finalized relay state.
        delete instantRelays[instantRelayHash];
    }

    /**
     * @notice Synchronize any balance changes in this contract with the utilized & liquid reserves. This would be done
     * at the conclusion of an L2 -> L1 token transfer via the canonical token bridge.
     */
    function sync() public nonReentrant() {
        _sync();
    }

    /**
     * @notice Computes the exchange rate between LP tokens and L1Tokens. Used when adding/removing liquidity.
     * @return The updated exchange rate between LP tokens and L1 tokens.
     */
    function exchangeRateCurrent() public nonReentrant() returns (uint256) {
        return _exchangeRateCurrent();
    }

    /**
     * @notice Computes the current liquidity utilization ratio.
     * @dev Used in computing realizedLpFeePct off-chain.
     * @return The current utilization ratio.
     */
    function liquidityUtilizationCurrent() public nonReentrant() returns (uint256) {
        return _liquidityUtilizationPostRelay(0);
    }

    /**
     * @notice Computes the liquidity utilization ratio post a relay of known size.
     * @dev Used in computing realizedLpFeePct off-chain.
     * @param relayedAmount Size of the relayed deposit to factor into the utilization calculation.
     * @return The updated utilization ratio accounting for a new `relayedAmount`.
     */
    function liquidityUtilizationPostRelay(uint256 relayedAmount) public nonReentrant() returns (uint256) {
        return _liquidityUtilizationPostRelay(relayedAmount);
    }

    /**
     * @notice Return both the current utilization value and liquidity utilization post the relay.
     * @dev Used in computing realizedLpFeePct off-chain.
     * @param relayedAmount Size of the relayed deposit to factor into the utilization calculation.
     * @return utilizationCurrent The current utilization ratio.
     * @return utilizationPostRelay The updated utilization ratio accounting for a new `relayedAmount`.
     */
    function getLiquidityUtilization(uint256 relayedAmount)
        public
        nonReentrant()
        returns (uint256 utilizationCurrent, uint256 utilizationPostRelay)
    {
        return (_liquidityUtilizationPostRelay(0), _liquidityUtilizationPostRelay(relayedAmount));
    }

    /**
     * @notice Updates the address stored in this contract for the OptimisticOracle and the Store to the latest versions
     * set in the the Finder. Also pull finalFee Store these as local variables to make relay methods gas efficient.
     * @dev There is no risk of leaving this function public for anyone to call as in all cases we want the addresses
     * in this contract to map to the latest version in the Finder and store the latest final fee.
     */
    function syncUmaEcosystemParams() public nonReentrant() {
        FinderInterface finder = FinderInterface(bridgeAdmin.finder());
        optimisticOracle = SkinnyOptimisticOracleInterface(
            finder.getImplementationAddress(OracleInterfaces.SkinnyOptimisticOracle)
        );

        store = StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
        l1TokenFinalFee = store.computeFinalFee(address(l1Token)).rawValue;
    }

    /**
     * @notice Updates the values of stored constants for the proposerBondPct, optimisticOracleLiveness and identifier
     * to that set in the bridge Admin. We store these as local variables to make the relay methods more gas efficient.
     * @dev There is no risk of leaving this function public for anyone to call as in all cases we want these values
     * in this contract to map to the latest version set in the BridgeAdmin.
     */
    function syncWithBridgeAdminParams() public nonReentrant() {
        proposerBondPct = bridgeAdmin.proposerBondPct();
        optimisticOracleLiveness = bridgeAdmin.optimisticOracleLiveness();
        identifier = bridgeAdmin.identifier();
    }

    /************************************
     *          ADMIN FUNCTIONS         *
     ************************************/

    /**
     * @notice Enable the current bridge admin to transfer admin to to a new address.
     * @dev Caller must be BridgeAdmin contract.
     * @param _newAdmin Admin address of the new admin.
     */
    function changeAdmin(address _newAdmin) public override onlyBridgeAdmin() nonReentrant() {
        bridgeAdmin = BridgeAdminInterface(_newAdmin);
        emit BridgePoolAdminTransferred(msg.sender, _newAdmin);
    }

    /**
     * @notice Enable the bridge admin to change the decay rate at which LP shares accumulate fees. The higher this
     * value, the faster LP shares realize pending fees.
     * @dev Caller must be BridgeAdmin contract.
     * @param _newLpFeeRatePerSecond The new rate to set.
     */
    function setLpFeeRatePerSecond(uint64 _newLpFeeRatePerSecond) public override onlyBridgeAdmin() nonReentrant() {
        lpFeeRatePerSecond = _newLpFeeRatePerSecond;
        emit LpFeeRateSet(lpFeeRatePerSecond);
    }

    /**
     * @notice Enable the bridge admin to enable/disable relays for this pool. Acts as a pause. Only effects
     * relayDeposit and relayAndSpeedUp methods. ALl other contract logic remains functional after a pause.
     * @dev Caller must be BridgeAdmin contract.
     * @param _relaysEnabled The new relaysEnabled state.
     */
    function setRelaysEnabled(bool _relaysEnabled) public override onlyBridgeAdmin() nonReentrant() {
        relaysEnabled = _relaysEnabled;
        emit RelaysEnabledSet(_relaysEnabled);
    }

    /************************************
     *           VIEW FUNCTIONS         *
     ************************************/

    /**
     * @notice Computes the current amount of unallocated fees that have accumulated from the previous time this the
     * contract was called.
     */
    function getAccumulatedFees() public view nonReentrantView() returns (uint256) {
        return _getAccumulatedFees();
    }

    /**
     * @notice Returns ancillary data containing all relevant Relay data that voters can format into UTF8 and use to
     * determine if the relay is valid.
     * @dev Helpful method to test that ancillary data is constructed properly. We should consider removing if we don't
     * anticipate off-chain bots or users to call this method.
     * @param depositData Contains L2 deposit information used by off-chain validators to validate relay.
     * @param relayData Contains relay information used by off-chain validators to validate relay.
     * @return bytes New ancillary data that can be decoded into UTF8.
     */
    function getRelayAncillaryData(DepositData memory depositData, RelayData memory relayData)
        public
        view
        nonReentrantView()
        returns (bytes memory)
    {
        return _getRelayAncillaryData(_getRelayHash(depositData, relayData));
    }

    /**************************************
     *    INTERNAL & PRIVATE FUNCTIONS    *
     **************************************/

    function _liquidityUtilizationPostRelay(uint256 relayedAmount) internal returns (uint256) {
        _sync(); // Fetch any balance changes due to token bridging finalization and factor them in.

        // liquidityUtilizationRatio :=
        // (relayedAmount + pendingReserves + max(utilizedReserves,0)) / (liquidReserves + max(utilizedReserves,0))
        // UtilizedReserves has a dual meaning: if it's greater than zero then it represents funds pending in the bridge
        // that will flow from L2 to L1. In this case, we can use it normally in the equation. However, if it is
        // negative, then it is already counted in liquidReserves. This occurs if tokens are transferred directly to the
        // contract. In this case, ignore it as it is captured in liquid reserves and has no meaning in the numerator.
        uint256 flooredUtilizedReserves = utilizedReserves > 0 ? uint256(utilizedReserves) : 0;
        uint256 numerator = relayedAmount + pendingReserves + flooredUtilizedReserves;
        uint256 denominator = liquidReserves + flooredUtilizedReserves;

        // If the denominator equals zero, return 1e18 (max utilization).
        if (denominator == 0) return 1e18;

        // In all other cases, return the utilization ratio.
        return (numerator * 1e18) / denominator;
    }

    function _sync() internal {
        // Check if the l1Token balance of the contract is greater than the liquidReserves. If it is then the bridging
        // action from L2 -> L1 has concluded and the local accounting can be updated.
        uint256 l1TokenBalance = l1Token.balanceOf(address(this)) - bonds;
        if (l1TokenBalance > liquidReserves) {
            // utilizedReserves can go to less than zero. This will happen if the accumulated fees exceeds the current
            // outstanding utilization. In other words, if outstanding bridging transfers are 0 then utilizedReserves
            // will equal the total LP fees accumulated over all time.
            utilizedReserves -= int256(l1TokenBalance - liquidReserves);
            liquidReserves = l1TokenBalance;
        }
    }

    function _exchangeRateCurrent() internal returns (uint256) {
        if (totalSupply() == 0) return 1e18; // initial rate is 1 pre any mint action.

        // First, update fee counters and local accounting of finalized transfers from L2 -> L1.
        _updateAccumulatedLpFees(); // Accumulate all allocated fees from the last time this method was called.
        _sync(); // Fetch any balance changes due to token bridging finalization and factor them in.

        // ExchangeRate := (liquidReserves + utilizedReserves - undistributedLpFees) / lpTokenSupply
        // Note that utilizedReserves can be negative. If this is the case, then liquidReserves is offset by an equal
        // and opposite size. LiquidReserves + utilizedReserves will always be larger than undistributedLpFees so this
        // int will always be positive so there is no risk in underflow in type casting in the return line.
        int256 numerator = int256(liquidReserves) + utilizedReserves - int256(undistributedLpFees);
        return (uint256(numerator) * 1e18) / totalSupply();
    }

    // Return UTF8-decodable ancillary data for relay price request associated with relay hash.
    function _getRelayAncillaryData(bytes32 relayHash) private pure returns (bytes memory) {
        return AncillaryData.appendKeyValueBytes32("", "relayHash", relayHash);
    }

    // Returns hash of unique relay and deposit event. This is added to the relay request's ancillary data.
    function _getRelayHash(DepositData memory depositData, RelayData memory relayData) private view returns (bytes32) {
        return keccak256(abi.encode(depositData, relayData.relayId, relayData.realizedLpFeePct, address(l1Token)));
    }

    // Return hash of relay data, which is stored in state and mapped to a deposit hash.
    function _getRelayDataHash(RelayData memory relayData) private pure returns (bytes32) {
        return keccak256(abi.encode(relayData));
    }

    // Reverts if the stored relay data hash for `depositHash` does not match `_relayData`.
    function _validateRelayDataHash(bytes32 depositHash, RelayData memory relayData) private view {
        require(
            relays[depositHash] == _getRelayDataHash(relayData),
            "Hashed relay params do not match existing relay hash for deposit"
        );
    }

    // Return hash of unique instant relay and deposit event. This is stored in state and mapped to a deposit hash.
    function _getInstantRelayHash(bytes32 depositHash, RelayData memory relayData) private pure returns (bytes32) {
        // Only include parameters that affect the "correctness" of an instant relay. For example, the realized LP fee
        // % directly affects how many tokens the instant relayer needs to send to the user, whereas the address of the
        // instant relayer does not matter for determining whether an instant relay is "correct".
        return keccak256(abi.encode(depositHash, relayData.realizedLpFeePct));
    }

    function _getAccumulatedFees() internal view returns (uint256) {
        // UnallocatedLpFees := min(undistributedLpFees*lpFeeRatePerSecond*timeFromLastInteraction,undistributedLpFees)
        // The min acts to pay out all fees in the case the equation returns more than the remaining a fees.
        uint256 possibleUnpaidFees =
            (undistributedLpFees * lpFeeRatePerSecond * (getCurrentTime() - lastLpFeeUpdate)) / (1e18);
        return possibleUnpaidFees < undistributedLpFees ? possibleUnpaidFees : undistributedLpFees;
    }

    // Update internal fee counters by adding in any accumulated fees from the last time this logic was called.
    function _updateAccumulatedLpFees() internal {
        // Calculate the unallocatedAccumulatedFees from the last time the contract was called.
        uint256 unallocatedAccumulatedFees = _getAccumulatedFees();

        // Decrement the undistributedLpFees by the amount of accumulated fees.
        undistributedLpFees = undistributedLpFees - unallocatedAccumulatedFees;

        lastLpFeeUpdate = uint32(getCurrentTime());
    }

    // Allocate fees to the LPs by incrementing counters.
    function _allocateLpFees(uint256 allocatedLpFees) internal {
        // Add to the total undistributed LP fees and the utilized reserves. Adding it to the utilized reserves acts to
        // track the fees while they are in transit.
        undistributedLpFees += allocatedLpFees;
        utilizedReserves += int256(allocatedLpFees);
    }

    function _getAmountFromPct(uint64 percent, uint256 amount) private pure returns (uint256) {
        return (percent * amount) / 1e18;
    }

    function _getProposerBond(uint256 amount) private view returns (uint256) {
        return _getAmountFromPct(proposerBondPct, amount);
    }

    function _getDepositHash(DepositData memory depositData) private view returns (bytes32) {
        return keccak256(abi.encode(depositData, address(l1Token)));
    }

    // Proposes new price of True for relay event associated with `customAncillaryData` to optimistic oracle. If anyone
    // disagrees with the relay parameters and whether they map to an L2 deposit, they can dispute with the oracle.
    function _requestProposeDispute(
        address proposer,
        address disputer,
        uint256 proposerBond,
        uint256 finalFee,
        bytes memory customAncillaryData
    ) private returns (bool) {
        uint256 totalBond = finalFee + proposerBond;
        l1Token.safeApprove(address(optimisticOracle), totalBond);
        try
            optimisticOracle.requestAndProposePriceFor(
                identifier,
                uint32(getCurrentTime()),
                customAncillaryData,
                IERC20(l1Token),
                // Set reward to 0, since we'll settle proposer reward payouts directly from this contract after a relay
                // proposal has passed the challenge period.
                0,
                // Set the Optimistic oracle proposer bond for the price request.
                proposerBond,
                // Set the Optimistic oracle liveness for the price request.
                optimisticOracleLiveness,
                proposer,
                // Canonical value representing "True"; i.e. the proposed relay is valid.
                int256(1e18)
            )
        returns (uint256 bondSpent) {
            if (bondSpent < totalBond) {
                // If the OO pulls less (due to a change in final fee), refund the proposer.
                uint256 refund = totalBond - bondSpent;
                l1Token.safeTransfer(proposer, refund);
                l1Token.safeApprove(address(optimisticOracle), 0);
                totalBond = bondSpent;
            }
        } catch {
            // If there's an error in the OO, this means something has changed to make this request undisputable.
            // To ensure the request does not go through by default, refund the proposer and return early, allowing
            // the calling method to delete the request, but with no additional recourse by the OO.
            l1Token.safeTransfer(proposer, totalBond);
            l1Token.safeApprove(address(optimisticOracle), 0);

            // Return early noting that the attempt at a proposal + dispute did not succeed.
            return false;
        }

        SkinnyOptimisticOracleInterface.Request memory request =
            SkinnyOptimisticOracleInterface.Request({
                proposer: proposer,
                disputer: address(0),
                currency: IERC20(l1Token),
                settled: false,
                proposedPrice: int256(1e18),
                resolvedPrice: 0,
                expirationTime: getCurrentTime() + optimisticOracleLiveness,
                reward: 0,
                finalFee: totalBond - proposerBond,
                bond: proposerBond,
                customLiveness: uint256(optimisticOracleLiveness)
            });

        // Note: don't pull funds until here to avoid any transfers that aren't needed.
        l1Token.safeTransferFrom(msg.sender, address(this), totalBond);
        l1Token.safeApprove(address(optimisticOracle), totalBond);
        // Dispute the request that we just sent.
        optimisticOracle.disputePriceFor(
            identifier,
            uint32(getCurrentTime()),
            customAncillaryData,
            request,
            disputer,
            address(this)
        );

        // Return true to denote that the proposal + dispute calls succeeded.
        return true;
    }

    // Unwraps ETH and does a transfer to a recipient address. If the recipient is a smart contract then sends WETH.
    function _unwrapWETHTo(address payable to, uint256 amount) internal {
        if (address(to).isContract()) {
            l1Token.safeTransfer(to, amount);
        } else {
            WETH9Like(address(l1Token)).withdraw(amount);
            to.transfer(amount);
        }
    }

    // Added to enable the BridgePool to receive ETH. used when unwrapping Weth.
    receive() external payable {}
}

/**
 * @notice This is the BridgePool contract that should be deployed on live networks. It is exactly the same as the
 * regular BridgePool contract, but it overrides getCurrentTime to make the call a simply return block.timestamp with
 * no branching or storage queries. This is done to save gas.
 */
contract BridgePoolProd is BridgePool {
    constructor(
        string memory _lpTokenName,
        string memory _lpTokenSymbol,
        address _bridgeAdmin,
        address _l1Token,
        uint64 _lpFeeRatePerSecond,
        bool _isWethPool,
        address _timer
    ) BridgePool(_lpTokenName, _lpTokenSymbol, _bridgeAdmin, _l1Token, _lpFeeRatePerSecond, _isWethPool, _timer) {}

    function getCurrentTime() public view virtual override returns (uint256) {
        return block.timestamp;
    }
}
