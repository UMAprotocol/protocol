// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./BridgeAdminInterface.sol";
import "../../../contracts/oracle/interfaces/OptimisticOracleInterface.sol";
import "../../../contracts/oracle/interfaces/StoreInterface.sol";
import "../../../contracts/oracle/interfaces/FinderInterface.sol";
import "../../../contracts/oracle/implementation/Constants.sol";
import "../../../contracts/common/implementation/AncillaryData.sol";
import "../../../contracts/common/implementation/Testable.sol";
import "../../../contracts/common/implementation/FixedPoint.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @notice Contract deployed on L1 that provides methods for "Relayers" to fulfill deposit orders that originated on L2.
 * The Relayers can either post capital to fulfill the deposit instantly, or request that the funds are taken out of
 * a passive liquidity provider pool following a challenge period. Related, this contract ingests liquidity from
 * passive liquidity providers and returns them claims to withdraw their funds. Liquidity providers are incentivized
 * to post collateral by earning a fee per fulfilled deposit order.
 * @dev A "Deposit" is an order to send capital from L2 to L1, and a "Relay" is a fulfillment attempt of that order.
 */
contract BridgePool is Testable {
    using SafeERC20 for IERC20;
    using FixedPoint for FixedPoint.Unsigned;

    // Administrative contract that deployed this contract and also houses all state variables needed to relay deposits.
    BridgeAdminInterface public bridgeAdmin;

    // A Relay represents a an attempt to finalize a cross-chain transfer that originated on an L2 DepositBox contract
    // and can be bridged via this contract.
    enum RelayState { Uninitialized, PendingSlow, PendingInstant, FinalizedSlow, FinalizedInstant }
    enum RelayType { Slow, Instant }

    // All data required by off-chain actors (validators, DVM voters, etc.) to verify that a relay is valid.
    struct RelayDataContents {
        uint64 depositTimestamp;
        uint64 maxFeePct;
        uint64 proposerRewardPct;
        uint64 realizedFeePct;
        uint64 depositId;
        uint256 amount;
        address l2Sender;
        address recipient;
        address l1Token;
        address slowRelayer;
    }

    // A Relay is linked to a Deposit object originating from L2
    struct Relay {
        RelayState relayState;
        RelayType relayType;
        // A deposit can have both a slow and an instant relayer if a slow relay is "sped up" from slow to instant.
        // We want to store both addresses for separate payouts.
        address instantRelayer;
    }
    // Associates each relay with a unique ancillary data hash derived from its constituent data. We need to key by the
    // ancillary data so that the OptimisticOracle can locate relays on callbacks using only price requests' ancillary
    // data
    mapping(bytes32 => Relay) public relays;
    // If a relay is disputed, it is removed from the `relays` mapping and added to the `disputedRelays` mapping.
    // There can only be one disputed relay per relayer for each relay ancillary data.
    mapping(bytes32 => Relay) public disputedRelays;

    event DepositRelayed(
        uint64 indexed depositId,
        address indexed sender,
        uint64 depositTimestamp,
        address recipient,
        address l1Token,
        uint256 amount,
        address slowRelayer,
        uint64 maxFeePct,
        uint64 proposerRewardPct,
        uint64 realizedFeePct,
        bytes32 indexed priceRequestAncillaryDataHash
    );
    event RelayDisputed(bytes32 indexed priceRequestAncillaryDataHash);
    event RelaySpedUp(uint64 indexed depositId, address indexed fastRelayer, address indexed slowRelayer);
    event FinalizedRelay(uint64 indexed depositId, address indexed caller);
    event RelayDisputeSettled(uint64 indexed depositId, address indexed caller, bool disputeSuccessful);
    event ProvidedLiquidity(address indexed token, uint256 amount, uint256 lpTokensMinted, address liquidityProvider);

    modifier onlyFromOptimisticOracle() {
        require(msg.sender == address(_getOptimisticOracle()), "Caller must be OptimisticOracle");
        _;
    }

    constructor(address _bridgeAdmin, address _timer) Testable(_timer) {
        bridgeAdmin = BridgeAdminInterface(_bridgeAdmin);
        require(bridgeAdmin.finder() != address(0), "Invalid bridge pool factory");
    }

    /*************************************************
     *          LIQUIDITY PROVIDER FUNCTIONS         *
     *************************************************/

    function deposit(address l1Token, uint256 amount) public {}

    function withdraw(address lpToken, uint256 amount) public {}

    /**************************************
     *          RELAYER FUNCTIONS         *
     **************************************/

    /**
     * @notice Called by Relayer to execute Slow relay from L2 to L1, fulfilling a corresponding deposit order.
     * @dev There can only be one pending Slow relay for a deposit ID.
     * @dev Caller must have approved this contract to spend the total bond for `l1Token`.
     * @param depositId Unique ID corresponding to deposit order that caller wants to relay.
     * @param depositTimestamp Timestamp of Deposit emitted by L2 contract when order was initiated.
     * @param recipient Address on this network who should receive the relayed deposit.
     * @param l1Token Token currency to pay recipient. This contract stores a mapping of `l1Token` to the
     *     canonical token currency on the L2 network that was deposited to the Deposit contract.
     * @param amount Deposited amount.
     * @param realizedFeePct Computed offchain by caller, considering the amount of available liquidity for the token
     * currency needed to pay the recipient and the count of pending withdrawals at the `depositTimestamp`. This fee
     * will be subtracted from the `amount`. If this value is computed incorrectly, then the relay can be disputed.
     * @param maxFeePct Maximum fee that L2 Depositor can pay. `realizedFee` <= `maxFee`.
     * @param proposerRewardPct Reward % of deposit amount to pay relayers.
     */
    function relayDeposit(
        uint64 depositId,
        uint64 depositTimestamp,
        address recipient,
        address l2Sender,
        address l1Token,
        uint256 amount,
        // TODO: Allow caller to distinguish between slow and fast fees/rewards.
        uint64 realizedFeePct,
        uint64 maxFeePct,
        uint64 proposerRewardPct
    ) public {
        require(realizedFeePct <= maxFeePct, "Invalid realized fee");

        // Construct unique ancillary data for this deposit, and link relay data to it.
        RelayDataContents memory relayData =
            RelayDataContents({
                depositId: depositId,
                l2Sender: l2Sender,
                recipient: recipient,
                depositTimestamp: depositTimestamp,
                l1Token: l1Token,
                amount: amount,
                maxFeePct: maxFeePct,
                proposerRewardPct: proposerRewardPct,
                realizedFeePct: realizedFeePct,
                slowRelayer: msg.sender
            });
        Relay storage newRelay = relays[keccak256(getRelayAncillaryData(relayData))];
        require(newRelay.relayState == RelayState.Uninitialized, "Pending relay exists");
        require(
            disputedRelays[keccak256(getRelayAncillaryData(relayData))].relayState == RelayState.Uninitialized,
            "Pending dispute by relayer for deposit ID exists"
        );

        // Save new deposit:
        newRelay.relayState = RelayState.PendingSlow;
        newRelay.relayType = RelayType.Slow;

        // Request a price for the relay identifier and propose "true" optimistically. These methods will pull the
        // (proposer reward + proposer bond + final fee) from the caller.
        // Note: We need to set a new price request timestamp instead of default setting to equal to the
        // `depositTimestamp`, which is dependent on the L2 VM on which the DepositContract is deployed. Imagine if
        // the timestamps on the L2 have an offset that are always "in the future" relative to L1 blocks, then the
        // OptimisticOracle would always reject requests.
        _requestOraclePriceRelay(
            l1Token,
            amount,
            getCurrentTime(),
            getRelayAncillaryData(relayData),
            proposerRewardPct
        );
        _proposeOraclePriceRelay(l1Token, amount, depositTimestamp, getRelayAncillaryData(relayData));

        // Since we only store the hash of the relay data contents, its important that we emit all relay params in an
        // event. This should aid off-chain clients who want to modify/query the deposit.
        emit DepositRelayed(
            depositId,
            l2Sender,
            depositTimestamp,
            recipient,
            l1Token,
            amount,
            msg.sender,
            maxFeePct,
            proposerRewardPct,
            realizedFeePct,
            keccak256(getRelayAncillaryData(relayData))
        );
    }

    function speedUpRelay(RelayDataContents memory _relayData) public {
        // Alternatively, force client to hash off-chain and pass `bytes32 _relayAncillaryDataHash` as param.
        Relay storage relay = relays[keccak256(getRelayAncillaryData(_relayData))];
        // TODO: Do stuff
    }

    function finalizeRelay(RelayDataContents memory _relayData) public {
        // Alternatively, force client to hash off-chain and pass `bytes32 _relayAncillaryDataHash` as param.
        Relay storage relay = relays[keccak256(getRelayAncillaryData(_relayData))];
        // TODO: Do stuff
    }

    function settleDisputedRelay(RelayDataContents memory _relayData) public {
        // Alternatively, force client to hash off-chain and pass `bytes32 _relayAncillaryDataHash` as param.
        Relay storage relay = relays[keccak256(getRelayAncillaryData(_relayData))];
        // TODO: Grab dispute result from DVM and do stuff.
    }

    /**
     * @notice OptimisticOracle will callback to this function after a pending relay is disputed.
     * @dev Only callable by OptimisticOracle.
     * @param identifier Identifier for price request tied to pending relay.
     * @param timestamp Timestamp for price request tied to pending relay.
     * @param ancillaryData Ancillary data for price request tied to pending relay.
     * @param refund Refund for price request tied to pending relay. This param is ignored but is part of the function
     * signature that the OptimisticOracle will callback.
     */
    function priceDisputed(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 refund
    ) public onlyFromOptimisticOracle {
        // TODO: Should we use the `refund` parameter at all? If we set `refundOnDispute`, then the OptimisticOracle
        // will return the relayer reward to this contract upon a dispute. Currently we'll ignore this param.

        Relay storage pendingRelay = relays[keccak256(ancillaryData)];

        // Copy pending relay data to dispute mapping, and then delete relay data to allow another relay to fulfill the
        // deposit.
        Relay storage disputedRelay = disputedRelays[keccak256(ancillaryData)];
        disputedRelay.relayState = pendingRelay.relayState;
        disputedRelay.relayType = pendingRelay.relayType;
        disputedRelay.instantRelayer = pendingRelay.instantRelayer;
        delete relays[keccak256(ancillaryData)];

        emit RelayDisputed(keccak256(ancillaryData));
    }

    /**
     * @notice Returns ancillary data containing all relevant Relay data that voters can format into UTF8 and use to
     * determine if the relay is valid.
     * @param _relayData Contains relevant relay data.
     * @return bytes New ancillary data that can be decoded into UTF8.
     */
    function getRelayAncillaryData(RelayDataContents memory _relayData) public view returns (bytes memory) {
        bytes memory intermediateAncillaryData = "";

        // Add relay data inferred from the original deposit on L2:
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "depositId",
            uint256(_relayData.depositId)
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "l2Sender",
            _relayData.l2Sender
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "recipient",
            _relayData.recipient
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "depositTimestamp",
            uint256(_relayData.depositTimestamp)
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "l1Token",
            _relayData.l1Token
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "amount",
            _relayData.amount
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "maxFeePct",
            uint256(_relayData.maxFeePct)
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "proposerRewardPct",
            uint256(_relayData.proposerRewardPct)
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "realizedFeePct",
            uint256(_relayData.realizedFeePct)
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "slowRelayer",
            _relayData.slowRelayer
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
     *        INTERNAL FUNCTIONS          *
     **************************************/

    function _getOptimisticOracle() private view returns (OptimisticOracleInterface) {
        return
            OptimisticOracleInterface(
                FinderInterface(bridgeAdmin.finder()).getImplementationAddress(OracleInterfaces.OptimisticOracle)
            );
    }

    function _getStore() private view returns (StoreInterface) {
        return StoreInterface(FinderInterface(bridgeAdmin.finder()).getImplementationAddress(OracleInterfaces.Store));
    }

    function _requestOraclePriceRelay(
        address l1Token,
        uint256 amount,
        uint256 requestTimestamp,
        bytes memory customAncillaryData,
        uint64 proposerRewardPct
    ) private {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
        uint256 proposerBondPct =
            FixedPoint.Unsigned(uint256(bridgeAdmin.proposerBondPct())).div(FixedPoint.fromUnscaledUint(1)).rawValue;

        // Optimistic oracle will pull proposer reward from passive LP pool.
        uint256 proposerReward =
            FixedPoint
                .Unsigned(uint256(proposerRewardPct))
                .div(FixedPoint.fromUnscaledUint(1))
                .mul(FixedPoint.Unsigned(amount))
                .rawValue;

        // Sanity check that pool balance is enough to cover relay amount + proposer reward.
        require(IERC20(l1Token).balanceOf(address(this)) >= amount + proposerReward, "Insufficient pool balance");

        IERC20(l1Token).safeApprove(address(optimisticOracle), proposerReward);
        optimisticOracle.requestPrice(
            bridgeAdmin.identifier(),
            requestTimestamp,
            customAncillaryData,
            IERC20(l1Token),
            proposerReward
        );

        // Set the Optimistic oracle liveness for the price request.
        optimisticOracle.setCustomLiveness(
            bridgeAdmin.identifier(),
            requestTimestamp,
            customAncillaryData,
            uint256(bridgeAdmin.optimisticOracleLiveness())
        );

        // Set the Optimistic oracle proposer bond for the price request.
        uint256 proposerBond = FixedPoint.Unsigned(proposerBondPct).mul(FixedPoint.Unsigned(amount)).rawValue;
        optimisticOracle.setBond(bridgeAdmin.identifier(), requestTimestamp, customAncillaryData, proposerBond);
    }

    function _proposeOraclePriceRelay(
        address l1Token,
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
        IERC20(l1Token).safeTransferFrom(msg.sender, address(this), totalBond);
        IERC20(l1Token).safeApprove(address(optimisticOracle), totalBond);
        optimisticOracle.proposePriceFor(
            msg.sender,
            address(this),
            bridgeAdmin.identifier(),
            requestTimestamp,
            customAncillaryData,
            1e18
        );
    }
}
