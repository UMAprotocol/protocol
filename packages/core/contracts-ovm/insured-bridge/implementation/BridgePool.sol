// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../interfaces/BridgeAdminInterface.sol";
import "../interfaces/BridgePoolInterface.sol";

import "../../../contracts/oracle/interfaces/OptimisticOracleInterface.sol";
import "../../../contracts/oracle/interfaces/StoreInterface.sol";
import "../../../contracts/oracle/interfaces/FinderInterface.sol";
import "../../../contracts/oracle/implementation/Constants.sol";

import "../../../contracts/common/implementation/AncillaryData.sol";
import "../../../contracts/common/implementation/Testable.sol";
import "../../../contracts/common/implementation/FixedPoint.sol";
import "../../../contracts/common/implementation/ExpandedERC20.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @notice Contract deployed on L1 that provides methods for "Relayers" to fulfill deposit orders that originated on L2.
 * The Relayers can either post capital to fulfill the deposit (instant relay), or request that the funds are taken out
 * of a passive liquidity provider pool following a challenge period (slow relay). This contract ingests liquidity from
 * passive liquidity providers and returns them claims to withdraw their funds. Liquidity providers are incentivized
 * to post collateral by earning a fee per fulfilled deposit order.
 * @dev A "Deposit" is an order to send capital from L2 to L1, and a "Relay" is a fulfillment attempt of that order.
 */
contract BridgePool is Testable, BridgePoolInterface, ExpandedERC20 {
    using SafeERC20 for IERC20;
    using FixedPoint for FixedPoint.Unsigned;

    // Token that this contract receives as LP deposits.
    IERC20 public override l1Token;

    // Reserves that are unutilized and withdrawable.
    uint256 public liquidReserves;

    // Reserves currently utilized due to L2-L1 transactions in flight.
    int256 public utilizedReserves;

    // Reserves that are not yet utilized but are pre-allocated for a pending relay.
    uint256 public pendingReserves;

    // Exponential decay exchange rate to accumulate fees to LPs over time.
    uint256 public lpFeeRatePerSecond;

    // Last timestamp that LP fees were updated.
    uint256 public lastLpFeeUpdate;

    // Cumulative undistributed LP fees. As fees accumulate, they are subtracted from this number.
    uint256 public undistributedLpFees;

    // Administrative contract that deployed this contract and also houses all state variables needed to relay deposits.
    BridgeAdminInterface public bridgeAdmin;

    // A Relay represents an attempt to finalize a cross-chain transfer that originated on an L2 DepositBox contract.
    enum RelayState { Uninitialized, Pending, Disputed, Finalized }

    // Data from L2 deposit transaction.
    struct DepositData {
        uint64 depositId;
        uint64 depositTimestamp;
        address l2Sender;
        address recipient;
        address l1Token;
        uint256 amount;
        uint64 slowRelayFeePct;
        uint64 instantRelayFeePct;
        uint64 quoteTimestamp;
    }

    // A Relay is linked to a L2 Deposit.
    struct RelayData {
        RelayState relayState;
        uint256 priceRequestTime;
        uint64 realizedLpFeePct;
        address slowRelayer;
        address instantRelayer;
    }

    // Associate deposits with pending relay data. When RelayState is Uninitialized, new relay attempts can be made for
    // this deposit. Contains information necessary to pay out relayers on successful relay. Deposits get reset to the
    // "Uninitialized" state when they are disputed on the OptimisticOracle.
    mapping(bytes32 => RelayData) public relays;

    // Associates ancillary data related to relay price request with the deposit hash that the relay is attempting to
    // fulfill. We need to key by the ancillary data so that the OptimisticOracle can locate relays on callbacks using
    // only price requests' ancillary data. The ancillary data should contain all information required by off-chain
    // actors (validators, DVM voters, etc.) to verify that a relay is valid.
    mapping(bytes32 => bytes32) public ancillaryDataToDepositHash;

    event LiquidityAdded(address indexed token, uint256 amount, uint256 lpTokensMinted, address liquidityProvider);
    event LiquidityRemoved(address indexed token, uint256 amount, uint256 lpTokensBurnt, address liquidityProvider);
    event DepositRelayed(
        uint64 depositId,
        address indexed sender,
        address slowRelayer,
        uint64 depositTimestamp,
        address recipient,
        address l1Token,
        uint256 amount,
        uint64 slowRelayFeePct,
        uint64 instantRelayFeePct,
        uint64 quoteTimestamp,
        uint64 realizedLpFeePct,
        bytes32 indexed priceRequestAncillaryDataHash,
        bytes32 indexed depositHash,
        address depositContract
    );
    event RelaySpedUp(bytes32 indexed depositHash, address indexed instantRelayer);
    event RelayDisputed(bytes32 indexed depositHash, bytes32 indexed priceRequestAncillaryDataHash);
    event RelaySettled(
        bytes32 indexed depositHash,
        bytes32 indexed priceRequestAncillaryDataHash,
        address indexed caller
    );

    modifier onlyFromOptimisticOracle() {
        require(msg.sender == address(_getOptimisticOracle()), "Caller must be OptimisticOracle");
        _;
    }

    /**
     * @notice Construct the Bridge Pool
     * @param _lpTokenName Name of the LP token to be deployed by this contract.
     * @param _lpTokenSymbol Symbol of the LP token to be deployed by this contract.
     * @param _bridgeAdmin Admin contract deployed alongside on L1. Stores global variables and has owner control.
     * @param _l1Token Address of the L1 token that this bridgePool holds. This is the token LPs deposit and is bridged.
     * @param _lpFeeRatePerSecond Interest rate payment that scales the amount of pending fees per second paid to LPs.
     * @param _timer Timer used to synchronize contract time in testing. Set to 0x000... in production.
     */
    constructor(
        string memory _lpTokenName,
        string memory _lpTokenSymbol,
        address _bridgeAdmin,
        address _l1Token,
        uint256 _lpFeeRatePerSecond,
        address _timer
    ) Testable(_timer) ExpandedERC20(_lpTokenName, _lpTokenSymbol, 18) {
        require(bytes(_lpTokenName).length != 0 && bytes(_lpTokenSymbol).length != 0, "Bad LP token name or symbol");
        bridgeAdmin = BridgeAdminInterface(_bridgeAdmin);

        l1Token = IERC20(_l1Token);
        lastLpFeeUpdate = getCurrentTime();
        lpFeeRatePerSecond = _lpFeeRatePerSecond;
    }

    /*************************************************
     *          LIQUIDITY PROVIDER FUNCTIONS         *
     *************************************************/

    /**
     * @notice Add liquidity to the bridge pool. Pulls l1tokens from the callers wallet. The caller is sent back a
     * commensurate number of LP tokens (minted to their address) at the prevailing exchange rate.
     * @dev The caller must approve this contract to transfer `l1TokenAmount` amount of l1Token.
     * @param l1TokenAmount Number of l1Token to add as liquidity.
     */
    function addLiquidity(uint256 l1TokenAmount) public {
        l1Token.safeTransferFrom(msg.sender, address(this), l1TokenAmount);

        uint256 lpTokensToMint =
            FixedPoint.Unsigned(l1TokenAmount).div(FixedPoint.Unsigned(exchangeRateCurrent())).rawValue;

        _mint(msg.sender, lpTokensToMint);

        liquidReserves += l1TokenAmount;

        emit LiquidityAdded(address(l1Token), l1TokenAmount, lpTokensToMint, msg.sender);
    }

    /**
     * @notice Removes liquidity to the bridge pool. Burns lpTokenAmount LP tokens from the callers wallet. The caller
     * is sent back a commensurate number of l1Tokens at the prevailing exchange rate.
     * @dev The caller does not need to approve the spending of LP tokens as this method directly uses the burn logic.
     * @param lpTokenAmount Number of lpTokens to redeem for underlying.
     */
    function removeLiquidity(uint256 lpTokenAmount) public {
        uint256 l1TokensToReturn =
            FixedPoint.Unsigned(lpTokenAmount).mul(FixedPoint.Unsigned(exchangeRateCurrent())).rawValue;

        // Check that there is enough liquid reserves to withdraw the requested amount.
        require(liquidReserves >= (pendingReserves + l1TokensToReturn), "Utilization too high to remove");

        _burn(msg.sender, lpTokenAmount);

        liquidReserves -= l1TokensToReturn;

        l1Token.safeTransfer(msg.sender, l1TokensToReturn);

        emit LiquidityRemoved(address(l1Token), l1TokensToReturn, lpTokenAmount, msg.sender);
    }

    /**************************************
     *          RELAYER FUNCTIONS         *
     **************************************/

    /**
     * @notice Called by Relayer to execute a slow relay from L2 to L1, fulfilling a corresponding deposit order.
     * @dev There can only be one pending relay for a deposit.
     * @dev Caller must have approved this contract to spend the total bond for `l1Token`.
     * @param depositId Unique ID corresponding to deposit order that caller wants to relay.
     * @param depositTimestamp Timestamp of Deposit emitted by L2 contract when order was initiated.
     * @param recipient Address on this network who should receive the relayed deposit.
     * @param l2Sender Address on the L2 network of depositor.
     * @param amount Amount deposited on L2 to be brought over to L1.
     * @param slowRelayFeePct Max fraction of `amount` that the depositor is willing to pay as a slow relay fee.
     * @param instantRelayFeePct Fraction of `amount` that the depositor is willing to pay as a instant relay fee.
     * @param quoteTimestamp Timestamp up until the depositor is willing to accept an LP quotation for.
     * @param realizedLpFeePct LP fee calculated off-chain considering the L1 pool liquidity at deposit time, before
     *      quoteTimestamp. The OO acts to verify the correctness of this realized fee. Can not exceed 50%.
     */
    function relayDeposit(
        uint64 depositId,
        uint64 depositTimestamp,
        address recipient,
        address l2Sender,
        uint256 amount,
        uint64 slowRelayFeePct,
        uint64 instantRelayFeePct,
        uint64 quoteTimestamp,
        uint64 realizedLpFeePct
    ) public {
        // The realizedLPFeePct should never be greater than 0.5e18 and the slow and instant relay fees should never be
        // more than 0.25e18 each. Therefore, the sum of all fee types can never exceed 1e18 (or 100%).
        require(slowRelayFeePct < 0.25e18);
        require(instantRelayFeePct < 0.25e18);
        require(realizedLpFeePct < 0.5e18);

        // Check if there is a pending undisputed relay for this deposit.
        DepositData memory depositData =
            DepositData({
                depositId: depositId,
                depositTimestamp: depositTimestamp,
                l2Sender: l2Sender,
                recipient: recipient,
                l1Token: address(l1Token),
                amount: amount,
                slowRelayFeePct: slowRelayFeePct,
                instantRelayFeePct: instantRelayFeePct,
                quoteTimestamp: quoteTimestamp
            });
        bytes32 depositHash = _getDepositHash(depositData);
        require(
            (relays[depositHash].relayState == RelayState.Uninitialized ||
                relays[depositHash].relayState == RelayState.Disputed),
            "Deposit already relayed"
        );

        // If no pending relay for this deposit, then associate the caller's relay attempt with it. Copy over the
        // instant relayer so that the recipient cannot receive double payments. This means that once a relay is
        // disputed, it cant be sped up a second time (must finalize via the slow relay).
        uint256 priceRequestTime = getCurrentTime();
        RelayData memory relayData =
            RelayData({
                relayState: RelayState.Pending,
                priceRequestTime: priceRequestTime,
                realizedLpFeePct: realizedLpFeePct,
                slowRelayer: msg.sender,
                instantRelayer: relays[depositHash].instantRelayer
            });
        relays[depositHash] = relayData;

        // Construct unique ancillary data for this relay attempt and associate it with the deposit in a reverse lookup
        // that the OptimisticOracle can use to mark disputed relay attempts.
        ancillaryDataToDepositHash[keccak256(getRelayAncillaryData(depositData, relayData))] = depositHash;

        // Sanity check that pool has enough balance to cover relay amount + proposer reward. Reward amount will be
        // paid on settlement after the OptimisticOracle price request has passed the challenge period.
        require(
            l1Token.balanceOf(address(this)) >= amount + _getProposerBond(amount) &&
                liquidReserves >= amount + _getProposerBond(amount),
            "Insufficient pool balance"
        );

        // Request a price for the relay identifier and propose "true" optimistically. These methods will pull the
        // (proposer reward + proposer bond + final fee) from the caller. We need to set a new price request timestamp
        // instead of default setting to equal to the `depositTimestamp`, which is dependent on the L2 VM on which the
        // DepositContract is deployed. Imagine if the timestamps on the L2 have an offset that are always "in the
        // future" relative to L1 blocks, then the OptimisticOracle would always reject requests.
        _requestOraclePriceRelay(amount, priceRequestTime, getRelayAncillaryData(depositData, relayData));
        _proposeOraclePriceRelay(amount, priceRequestTime, getRelayAncillaryData(depositData, relayData));

        pendingReserves += amount; // Book off maximum liquidity used by this relay in the pending reserves.

        // We use an internal method to emit this event to overcome Solidity's "stack too deep" error.
        _emitDepositRelayedEvent(
            depositData,
            realizedLpFeePct,
            keccak256(getRelayAncillaryData(depositData, relayData)),
            depositHash
        );
    }

    /**
     * @notice Instantly relay a deposit amount minus fees to the recipient. Instant relayer earns a reward following
     * the pending relay challenge period.
     * @dev We assume that the caller has performed an off-chain check that the deposit data they are attempting to
     * relay is valid. If the deposit data is invalid, then the instant relayer has no recourse
     * to receive their funds back after the invalid deposit data is disputed. Moreover, no one will be able to
     * resubmit a relay for the invalid deposit data because they know it will get disputed again. On the other hand,
     * if the deposit data is valid, then even if it is falsely disputed, the instant relayer will eventually get
     * reimbursed because someone else will be incentivized to resubmit the relay to earn slow relayer rewards. Once the
     * valid relay is finalized, the instant relayer will be reimbursed.
     * @dev Caller must have approved this contract to spend the deposit amount of L1 tokens to relay. There can only
     * be one instant relayer per relay attempt and disputed relays cannot be sped up.
     * @param _depositData Unique set of L2 deposit data that caller is trying to instantly relay.
     */
    function speedUpRelay(DepositData memory _depositData) public {
        bytes32 depositHash = _getDepositHash(_depositData);
        RelayData storage relay = relays[depositHash];
        require(
            relays[depositHash].relayState == RelayState.Pending && relays[depositHash].instantRelayer == address(0),
            "Relay can not be sped up"
        );
        relay.instantRelayer = msg.sender;

        // Pull relay amount minus fees from caller and send to the deposit recipient. The total fees paid is the sum
        // of the LP fees, the relayer fees and the instant relay fee.
        uint256 feesTotal =
            _getAmountFromPct(
                relay.realizedLpFeePct + _depositData.slowRelayFeePct + _depositData.instantRelayFeePct,
                _depositData.amount
            );

        l1Token.safeTransferFrom(msg.sender, _depositData.recipient, _depositData.amount - feesTotal);

        emit RelaySpedUp(depositHash, msg.sender);
    }

    /**
     * @notice Reward relayers if a pending relay price request has a price available on the OptimisticOracle. Mark
     * the relay as complete.
     * @param _depositData Unique set of L2 deposit data that caller is trying to settle a relay for.
     */
    function settleRelay(DepositData memory _depositData) public {
        bytes32 depositHash = _getDepositHash(_depositData);
        RelayData storage relay = relays[depositHash];

        // If relay was disputed, then parties in dispute need to go through OptimisticOracle to resolve dispute.
        require(relays[depositHash].relayState == RelayState.Pending, "Relay not settleable");

        // Attempt to settle OptimisticOracle price as a convenience for the slow relayer who will receive their
        // dispute bond back. If the price is not settleable, then this call will revert. If the price has already
        // been settled, then this will not revert and still return the price.
        require(
            _getOptimisticOracle().settleAndGetPrice(
                bridgeAdmin.identifier(),
                relay.priceRequestTime,
                getRelayAncillaryData(_depositData, relay)
            ) == int256(1e18), // Canonical value representing "True"; i.e. the proposed relay is valid.
            "Relay request was not valid"
        );

        // Update the relay state to Finalized. This prevents any re-settling of a relay.
        relay.relayState = RelayState.Finalized;

        // Reward relayers and pay out recipient.
        // At this point there are two possible cases:
        // - This was a slow relay: In this case, a) pay the slow relayer their reward and b) pay the recipient of the
        //      amount minus the realized LP fee and the slow Relay fee. The transfer was not sped up so no instant fee.
        // - This was a instant relay: In this case, a) pay the slow relayer their reward and b) pay the instant relayer
        //      the full bridging amount, minus the realized LP fee and minus the slow relay fee. When the instant
        //      relayer called speedUpRelay they were docked this same amount, minus the instant relayer fee. As a
        //      result, they are effectively paid what they spent when speeding up the relay + the instantRelayFee.

        uint256 instantRelayerOrRecipientAmount =
            _depositData.amount -
                _getAmountFromPct(relay.realizedLpFeePct + _depositData.slowRelayFeePct, _depositData.amount);

        l1Token.safeTransfer(
            relay.instantRelayer != address(0) ? relay.instantRelayer : _depositData.recipient,
            instantRelayerOrRecipientAmount
        );

        // The slow relayer gets paid the slow relay fee. This is the same irrespective if the relay was sped up or not.
        uint256 slowRelayerAmount = _getAmountFromPct(_depositData.slowRelayFeePct, _depositData.amount);
        l1Token.safeTransfer(relay.slowRelayer, slowRelayerAmount);

        uint256 totalAmountSent = instantRelayerOrRecipientAmount + slowRelayerAmount;

        // Update reserves by amounts changed and allocated LP fees.
        pendingReserves -= _depositData.amount;
        liquidReserves -= totalAmountSent;
        utilizedReserves += int256(totalAmountSent);
        updateAccumulatedLpFees();
        allocateLpFees(_getAmountFromPct(relay.realizedLpFeePct, _depositData.amount));

        emit RelaySettled(depositHash, keccak256(getRelayAncillaryData(_depositData, relay)), msg.sender);
    }

    /**
     * @notice OptimisticOracle will callback to this function after a pending relay is disputed. This function should
     * ensure that another slow relayer can fulfill the disputed relay for an L2 deposit.
     * @param identifier Price identifier used when requesting OO price. Unused.
     * @param timestamp Unix timestamp of the price request. Unused.
     * @param ancillaryData AncillaryData of the price request. Use to find the associated disputed relay action.
     * @param refund Amount refunded for the dispute. Unused.
     */
    function priceDisputed(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 refund
    ) public onlyFromOptimisticOracle {
        bytes32 depositHash = ancillaryDataToDepositHash[keccak256(ancillaryData)];
        RelayData storage relay = relays[depositHash];

        // Mark pending relay as disputed but do not delete instant relayer information which should be copied over to
        // next slow relay.
        relay.relayState = RelayState.Disputed;

        // We do not need to reset the other state in `relay` aside from `instantRelayer` because all of the state
        // params get rewritten from global state in a `relayDeposit()` call.
        emit RelayDisputed(depositHash, keccak256(ancillaryData));
    }

    /**
     * @notice Synchronize any balance changes in this contract with the utilized & liquid reserves. This would be done
     * at the conclusion of an L2->L1 token transfer via the canonical token bridge.
     */
    function sync() public {
        // Check if the l1Token balance of the contract is greater than the liquidReserves. If it is then the bridging
        // action from L2->L1 has concluded and the local accounting can be updated.
        uint256 l1TokenBalance = l1Token.balanceOf(address(this));
        if (l1TokenBalance > liquidReserves) {
            // utilizedReserves can go to less than zero. This will happen if the accumulated fees exceeds the current
            // outstanding utilization. In other words, if outstanding bridging transfers are 0 then utilizedReserves
            // will equal the total LP fees accumulated over all time.
            utilizedReserves -= int256(l1TokenBalance - liquidReserves);
            liquidReserves = l1TokenBalance;
        }
    }

    /**
     * @notice Computes the exchange rate between LP tokens and L1Tokens. Used when adding/removing liquidity.
     */
    function exchangeRateCurrent() public returns (uint256) {
        if (totalSupply() == 0) return 1e18; //initial rate is 1 pre any mint action.

        // First, update fee counters and local accounting of finalized transfers from L2->L1.
        updateAccumulatedLpFees(); // Accumulate all allocated fees from the last time this method was called.
        sync(); // Fetch any balance changes due to token bridging finalization and factor them in.

        // ExchangeRate := (liquidReserves+utilizedReserves-undistributedLpFees)/lpTokenSupply
        // Note to accommodate negative utilizedReserves without using FixedPoint.Signed we need to do a bit of
        // branching logic. This is a gas optimization so we don't need to import this extra library logic.
        FixedPoint.Unsigned memory numerator =
            FixedPoint.Unsigned(liquidReserves).sub(FixedPoint.Unsigned(undistributedLpFees));
        if (utilizedReserves > 0) numerator = numerator.add(FixedPoint.Unsigned(uint256(utilizedReserves)));
        else numerator = numerator.sub(FixedPoint.Unsigned(uint256(utilizedReserves * -1)));
        return numerator.div(FixedPoint.Unsigned(totalSupply())).rawValue;
    }

    /************************************
     *           View FUNCTIONS         *
     ************************************/

    /**
     * @notice Computes the current amount of unallocated fees that have accumulated from the previous time this the
     * contract was called.
     */
    function getAccumulatedFees() public view returns (uint256) {
        // UnallocatedLpFees := min(undistributedLpFees*lpFeeRatePerSecond*timeFromLastInteraction,undistributedLpFees)
        // The min acts to pay out all fees in the case the equation returns more than the remaining a fees.
        return
            FixedPoint
                .Unsigned(undistributedLpFees)
                .mul(FixedPoint.Unsigned(lpFeeRatePerSecond))
                .mul(FixedPoint.fromUnscaledUint(getCurrentTime() - lastLpFeeUpdate))
                .min(FixedPoint.Unsigned(undistributedLpFees))
                .rawValue;
    }

    /**
     * @notice Returns ancillary data containing all relevant Relay data that voters can format into UTF8 and use to
     * determine if the relay is valid.
     * @param _depositData Contains L2 deposit information used by off-chain validators to validate relay.
     * @param _relayData Contains relay information used by off-chain validators to validate relay.
     * @return bytes New ancillary data that can be decoded into UTF8.
     */
    function getRelayAncillaryData(DepositData memory _depositData, RelayData memory _relayData)
        public
        view
        returns (bytes memory)
    {
        // TODO: Consider adding `chainId` and `relayNonce` to establish relay uniqueness, and removing unneccessary
        // params.
        bytes memory intermediateAncillaryData = "";

        // Add data inferred from the original deposit on L2:
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "depositId",
            uint256(_depositData.depositId)
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "depositTimestamp",
            uint256(_depositData.depositTimestamp)
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "recipient",
            _depositData.recipient
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "l2Sender",
            _depositData.l2Sender
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "l1Token",
            _depositData.l1Token
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "amount",
            _depositData.amount
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "slowRelayFeePct",
            uint256(_depositData.slowRelayFeePct)
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "instantRelayFeePct",
            uint256(_depositData.instantRelayFeePct)
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "quoteTimestamp",
            uint256(_depositData.quoteTimestamp)
        );

        // Add relay data.
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "realizedLpFeePct",
            uint256(_relayData.realizedLpFeePct)
        );

        // Add global state data stored by this contract:
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "depositContract",
            bridgeAdmin.depositContract()
        );

        return intermediateAncillaryData;
    }

    /**************************************
     *    INTERNAL & PRIVATE FUNCTIONS    *
     **************************************/

    // Update internal fee counters by adding in any accumulated fees from the last time this logic was called.
    function updateAccumulatedLpFees() internal {
        // Calculate the unallocatedAccumulatedFees from the last time the contract was called.
        uint256 unallocatedAccumulatedFees = getAccumulatedFees();

        // Decrement the undistributedLpFees by the amount of accumulated fees.
        undistributedLpFees = undistributedLpFees - unallocatedAccumulatedFees;

        lastLpFeeUpdate = getCurrentTime();
    }

    // Allocate fees to the LPs by incrementing counters.
    function allocateLpFees(uint256 allocatedLpFees) internal {
        // Add to the total undistributed LP fees and the utilized reserves. Adding it to the utilized reserves acts to
        // track the fees while they are in transit.
        if (allocatedLpFees > 0) {
            undistributedLpFees += allocatedLpFees;
            utilizedReserves += int256(allocatedLpFees);
        }
    }

    function _getOptimisticOracle() private view returns (OptimisticOracleInterface) {
        return
            OptimisticOracleInterface(
                FinderInterface(bridgeAdmin.finder()).getImplementationAddress(OracleInterfaces.OptimisticOracle)
            );
    }

    function _getStore() private view returns (StoreInterface) {
        return StoreInterface(FinderInterface(bridgeAdmin.finder()).getImplementationAddress(OracleInterfaces.Store));
    }

    function _getAmountFromPct(uint64 percent, uint256 amount) private pure returns (uint256) {
        return
            FixedPoint
                .Unsigned(uint256(percent))
                .div(FixedPoint.fromUnscaledUint(1))
                .mul(FixedPoint.Unsigned(amount))
                .rawValue;
    }

    function _getProposerBond(uint256 amount) private view returns (uint256) {
        return _getAmountFromPct(bridgeAdmin.proposerBondPct(), amount);
    }

    function _getDepositHash(DepositData memory _depositData) private pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _depositData.depositId,
                    _depositData.depositTimestamp,
                    _depositData.recipient,
                    _depositData.l2Sender,
                    _depositData.l1Token,
                    _depositData.amount,
                    _depositData.slowRelayFeePct,
                    _depositData.instantRelayFeePct,
                    _depositData.quoteTimestamp
                )
            );
    }

    function _requestOraclePriceRelay(
        uint256 amount,
        uint256 requestTimestamp,
        bytes memory customAncillaryData
    ) private {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();

        // Set reward to 0, since we'll settle proposer reward payouts directly from this contract after a relay
        // proposal has passed the challenge period.
        optimisticOracle.requestPrice(
            bridgeAdmin.identifier(),
            requestTimestamp,
            customAncillaryData,
            IERC20(l1Token),
            0
        );

        // Set the Optimistic oracle liveness for the price request.
        optimisticOracle.setCustomLiveness(
            bridgeAdmin.identifier(),
            requestTimestamp,
            customAncillaryData,
            uint256(bridgeAdmin.optimisticOracleLiveness())
        );

        // Set the Optimistic oracle proposer bond for the price request.
        uint256 proposerBond = _getProposerBond(amount);
        optimisticOracle.setBond(bridgeAdmin.identifier(), requestTimestamp, customAncillaryData, proposerBond);
    }

    function _proposeOraclePriceRelay(
        uint256 amount,
        uint256 requestTimestamp,
        bytes memory customAncillaryData
    ) private {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
        uint256 proposerBondPct =
            FixedPoint.Unsigned(uint256(bridgeAdmin.proposerBondPct())).div(FixedPoint.fromUnscaledUint(1)).rawValue;
        uint256 finalFee = _getStore().computeFinalFee(address(l1Token)).rawValue;

        uint256 totalBond =
            FixedPoint
                .Unsigned(proposerBondPct)
                .mul(FixedPoint.Unsigned(amount))
                .add(FixedPoint.Unsigned(finalFee))
                .rawValue;

        // Pull the total bond from the caller so that the OptimisticOracle can subsequently pull it from here.
        l1Token.safeTransferFrom(msg.sender, address(this), totalBond);
        l1Token.safeApprove(address(optimisticOracle), totalBond);
        optimisticOracle.proposePriceFor(
            msg.sender,
            address(this),
            bridgeAdmin.identifier(),
            requestTimestamp,
            customAncillaryData,
            1e18 // Canonical value representing "True"; i.e. the proposed relay is valid.
        );
    }

    function _emitDepositRelayedEvent(
        DepositData memory _depositData,
        uint64 realizedLpFeePct,
        bytes32 _ancillaryDataHash,
        bytes32 _depositHash
    ) private {
        // Emit only information that is not stored in this contract. The relay data associated with the `_depositHash`
        // can be queried on-chain via the `relays` mapping keyed by `_depositHash`.
        emit DepositRelayed(
            _depositData.depositId,
            _depositData.l2Sender,
            msg.sender,
            _depositData.depositTimestamp,
            _depositData.recipient,
            _depositData.l1Token,
            _depositData.amount,
            _depositData.slowRelayFeePct,
            _depositData.instantRelayFeePct,
            _depositData.quoteTimestamp,
            realizedLpFeePct,
            _ancillaryDataHash,
            _depositHash,
            bridgeAdmin.depositContract()
        );
    }
}
