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
    enum RelayState { Uninitialized, Pending, Finalized }

    // Data from L2 deposit transaction.
    struct DepositData {
        uint64 depositTimestamp;
        uint64 maxFeePct;
        uint64 depositId;
        uint256 amount;
        address l2Sender;
        address recipient;
        address l1Token;
    }

    // A Relay is linked to a L2 Deposit.
    struct RelayData {
        RelayState relayState;
        uint256 priceRequestTime;
        uint64 proposerRewardPct;
        uint64 realizedFeePct;
        address slowRelayer;
        address instantRelayer;
    }

    // Associate deposits with pending relay data. When RelayState is Uninitialized, new relay attempts can be
    // made for this deposit. Contains information neccessary to pay out relayers on successful relay. Deposits get
    // reset to the "Uninitialized" state when they are disputed on the OptimisticOracle.
    mapping(bytes32 => RelayData) public relays;
    // Associates ancillary data related to relay price request with the deposit hash that the relay is attempting to
    // fulfill. We need to key by the ancillary data so that the OptimisticOracle can locate relays on callbacks using
    // only price requests' ancillary data. The ancillary data should contain all information required by off-chain
    // actors (validators, DVM voters, etc.) to verify that a relay is valid.
    mapping(bytes32 => bytes32) public ancillaryDataToDepositHash;

    event DepositRelayed(
        uint64 depositId,
        address indexed sender,
        uint64 depositTimestamp,
        address recipient,
        address l1Token,
        uint256 amount,
        uint64 maxFeePct,
        bytes32 indexed priceRequestAncillaryDataHash,
        bytes32 indexed depositHash,
        address depositContract
    );
    event RelaySpedUp(bytes32 indexed depositHash, address indexed instantRelayer);
    event RelayDisputed(bytes32 indexed depositHash, bytes32 indexed priceRequestAncillaryDataHash);
    event FinalizedRelay(bytes32 indexed depositHash, address indexed caller);
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
     * @dev There can only be one pending relay for a deposit.
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

        // Check if there is a pending relay for this deposit.
        DepositData memory depositData =
            DepositData({
                depositId: depositId,
                l2Sender: l2Sender,
                recipient: recipient,
                depositTimestamp: depositTimestamp,
                l1Token: l1Token,
                amount: amount,
                maxFeePct: maxFeePct
            });
        bytes32 depositHash =
            keccak256(
                abi.encode(
                    depositData.depositTimestamp,
                    depositData.maxFeePct,
                    depositData.depositId,
                    depositData.amount,
                    depositData.l2Sender,
                    depositData.recipient,
                    depositData.l1Token
                )
            );
        require(relays[depositHash].relayState == RelayState.Uninitialized, "Pending relay for deposit exists");

        // If no pending relay for this deposit, then associate the caller's relay attempt with it. Copy over the
        // instant relayer so that the recipient cannot receive double payments.
        uint256 priceRequestTime = getCurrentTime();
        RelayData memory relayData =
            RelayData({
                relayState: RelayState.Pending,
                priceRequestTime: priceRequestTime,
                proposerRewardPct: proposerRewardPct,
                realizedFeePct: realizedFeePct,
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
            IERC20(l1Token).balanceOf(address(this)) >= amount + _getProposerRewardAmount(proposerRewardPct, amount),
            "Insufficient pool balance"
        );

        // Request a price for the relay identifier and propose "true" optimistically. These methods will pull the
        // (proposer reward + proposer bond + final fee) from the caller.
        // Note: We need to set a new price request timestamp instead of default setting to equal to the
        // `depositTimestamp`, which is dependent on the L2 VM on which the DepositContract is deployed. Imagine if
        // the timestamps on the L2 have an offset that are always "in the future" relative to L1 blocks, then the
        // OptimisticOracle would always reject requests.
        _requestOraclePriceRelay(l1Token, amount, priceRequestTime, getRelayAncillaryData(depositData, relayData));
        _proposeOraclePriceRelay(l1Token, amount, priceRequestTime, getRelayAncillaryData(depositData, relayData));

        // We use an internal method to emit this event to overcome Solidity's "stack too deep" error.
        _emitDepositRelayedEvent(depositData, keccak256(getRelayAncillaryData(depositData, relayData)), depositHash);
    }

    // TODO: Implement fully the following functions:
    function speedUpRelay(bytes32 _depositHash) public {
        RelayData storage relay = relays[_depositHash];
        require(relays[_depositHash].relayState == RelayState.Pending, "Can only speed up pending slow relay");
        require(relays[_depositHash].instantRelayer == address(0), "Relay has already been instant relayed");
        relay.instantRelayer = msg.sender;
        // TODO: Pull funds from caller.
        emit RelaySpedUp(_depositHash, msg.sender);
    }

    function settleRelay(bytes32 _depositHash) public {
        RelayData storage relay = relays[_depositHash];
        // TODO: Pay relayer rewards using PendingRelay data.
    }

    /**
     * @notice OptimisticOracle will callback to this function after a pending relay is disputed. This function should
     * ensure that another slow relayer can fulfill the disputed relay for an L2 deposit.
     */
    function priceDisputed(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 refund
    ) public onlyFromOptimisticOracle {
        bytes32 depositHash = ancillaryDataToDepositHash[keccak256(ancillaryData)];
        RelayData storage relay = relays[depositHash];

        // Mark pending relay as uninitialized but do not delete instant relayer information which should be copied
        // over to next slow relay.
        relay.relayState = RelayState.Uninitialized;

        // TODO: Do we need to reset the other state in `relay` aside from `instantRelayer` which we want to save?
        emit RelayDisputed(depositHash, keccak256(ancillaryData));
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
        bytes memory intermediateAncillaryData = "";

        // Add data inferred from the original deposit on L2:
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "depositId",
            uint256(_depositData.depositId)
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "l2Sender",
            _depositData.l2Sender
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "recipient",
            _depositData.recipient
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "depositTimestamp",
            uint256(_depositData.depositTimestamp)
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
            "maxFeePct",
            uint256(_depositData.maxFeePct)
        );

        // Add relay data.
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

    function _getProposerRewardAmount(uint64 _proposerRewardPct, uint256 _amount) private pure returns (uint256) {
        return
            FixedPoint
                .Unsigned(uint256(_proposerRewardPct))
                .div(FixedPoint.fromUnscaledUint(1))
                .mul(FixedPoint.Unsigned(_amount))
                .rawValue;
    }

    function _requestOraclePriceRelay(
        address l1Token,
        uint256 amount,
        uint256 requestTimestamp,
        bytes memory customAncillaryData
    ) private {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
        uint256 proposerBondPct =
            FixedPoint.Unsigned(uint256(bridgeAdmin.proposerBondPct())).div(FixedPoint.fromUnscaledUint(1)).rawValue;

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
            1e18 // Canonical value representing "True"; i.e. the proposed relay is valid.
        );
    }

    function _emitDepositRelayedEvent(
        DepositData memory _depositData,
        bytes32 _ancillaryDataHash,
        bytes32 _depositHash
    ) private {
        // Emit only information that is not stored in this contract. The relay data associated with the `_depositHash`
        // can be queried on-chain via the `relays` mapping keyed by `_depositHash`.
        emit DepositRelayed(
            _depositData.depositId,
            _depositData.l2Sender,
            _depositData.depositTimestamp,
            _depositData.recipient,
            _depositData.l1Token,
            _depositData.amount,
            _depositData.maxFeePct,
            _ancillaryDataHash,
            _depositHash,
            bridgeAdmin.depositContract()
        );
    }
}
