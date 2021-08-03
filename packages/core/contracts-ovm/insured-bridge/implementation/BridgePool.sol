// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./BridgePoolFactory.sol";
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
    BridgePoolFactory public bridgePoolFactory;

    // A Deposit represents a transfer that originated on an L2 DepositBox contract and can be bridged via this contract.
    enum DepositState { Uninitialized, PendingSlow, PendingInstant, FinalizedSlow, FinalizedInstant }
    enum DepositType { Slow, Instant }

    // @dev: There is a limit to how many params a struct can contain. Without encapsulating some of the Deposit params
    // inside the RelayAncillaryDataContents struct, the compiler throws an error related to this issue:
    // https://github.com/ethereum/solidity/issues/10930.
    struct RelayAncillaryDataContents {
        uint256 depositId;
        // The following params are inferred from the L2 deposit:
        address l2Sender;
        address recipient;
        uint256 depositTimestamp;
        address l1Token;
        uint256 amount;
        uint256 maxFeePct;
        uint256 proposerRewardPct;
        // Relayer will compute the realized fee considering the amount of liquidity in this contract and the pending
        // withdrawals at the depositTimestamp.
        uint256 realizedFeePct;
        address slowRelayer;
    }
    struct Deposit {
        DepositState depositState;
        DepositType depositType;
        // A deposit can have both a slow and an instant relayer if a slow relay is "sped up" from slow to instant.
        // We want to store both addresses for separate payouts.
        address instantRelayer;
        // @dev: See note above about why some Deposit params are collapsed into `RelayAncillaryDataContents`.
        RelayAncillaryDataContents relayData;
        // Custom ancillary data crafted from `RelayAncillaryDataContents` data.
        bytes priceRequestAncillaryData;
    }
    // Associates each deposit with a unique ID.
    mapping(uint256 => Deposit) public deposits;
    // If a deposit is disputed, it is removed from the `deposits` mapping and added to the `disputedDeposits` mapping.
    // There can only be one disputed deposit per relayer for each deposit ID.
    // @dev The mapping is `depositId-->disputer-->Deposit`
    mapping(uint256 => mapping(address => Deposit)) public disputedDeposits;

    event DepositRelayed(
        address indexed sender,
        uint256 indexed depositTimestamp,
        address recipient,
        address indexed l1Token,
        address slowRelayer,
        uint256 amount,
        uint256 proposerRewardPct,
        uint256 realizedFeePct,
        address depositContract
    );
    event RelaySpedUp(uint256 indexed depositId, address indexed fastRelayer, address indexed slowRelayer);
    event FinalizedRelay(uint256 indexed depositId, address indexed caller);
    event RelayDisputeSettled(uint256 indexed depositId, address indexed caller, bool disputeSuccessful);
    event ProvidedLiquidity(address indexed token, uint256 amount, uint256 lpTokensMinted, address liquidityProvider);

    constructor(address _bridgePoolFactory, address _timer) Testable(_timer) {
        bridgePoolFactory = BridgePoolFactory(_bridgePoolFactory);
        require(bridgePoolFactory.finder() != address(0), "Invalid bridge pool factory");
    }

    /*********************************
     * Liquidity Provision Functions *
     *********************************/

    function deposit(address l1Token, uint256 amount) public {}

    function withdraw(address lpToken, uint256 amount) public {}

    /*********************************
     * Relayer Functions *
     *********************************/

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
        uint256 depositId,
        uint256 depositTimestamp,
        address recipient,
        address l2Sender,
        address l1Token,
        uint256 amount,
        // TODO: Allow caller to distinguish between slow and fast fees/rewards.
        uint256 realizedFeePct,
        uint256 maxFeePct,
        uint256 proposerRewardPct
    ) public {
        require(realizedFeePct <= maxFeePct, "Invalid realized fee");
        Deposit storage newDeposit = deposits[depositId];
        require(newDeposit.depositState == DepositState.Uninitialized, "Pending relay for deposit ID exists");
        Deposit storage disputedDeposit = disputedDeposits[depositId][msg.sender];
        require(
            disputedDeposit.depositState == DepositState.Uninitialized,
            "Pending dispute by relayer for deposit ID exists"
        );

        // Save new deposit:
        newDeposit.depositState = DepositState.PendingSlow;
        newDeposit.depositType = DepositType.Slow;
        newDeposit.relayData = RelayAncillaryDataContents({
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
        newDeposit.priceRequestAncillaryData = getRelayAncillaryData(newDeposit.relayData);

        // Request a price for the relay identifier and propose "true" optimistically. These methods will pull the
        // (proposer reward + proposer bond + final fee) from the caller.
        // Note: We can't simply set the price request timestamp equal to the `depositTimestamp`, which is dependent
        // on the L2 VM on which the DepositContract is deployed. Imagine if the timestamps on the L2 have an offset
        // that are always "in the future" relative to L1 blocks, then the OptimisticOracle would always reject
        // requests.
        uint256 requestTimestamp = getCurrentTime();
        _requestOraclePriceRelay(
            l1Token,
            amount,
            requestTimestamp,
            newDeposit.priceRequestAncillaryData,
            proposerRewardPct
        );
        _proposeOraclePriceRelay(l1Token, amount, depositTimestamp, newDeposit.priceRequestAncillaryData);

        // TODO: There is more data we'd like to emit, such as depositId, but we are limited by how many variables
        // we can fit into an event. Perhaps we need multiple events? Or think more critically about what information
        // clients will want.
        emit DepositRelayed(
            l2Sender,
            depositTimestamp,
            recipient,
            l1Token,
            msg.sender,
            amount,
            proposerRewardPct,
            realizedFeePct,
            bridgePoolFactory.depositContract()
        );
    }

    function speedUpRelay(uint256 depositId) public {}

    function finalizeRelay(uint256 depositId) public {}

    function settleDisputedRelay(uint256 depositId, address slowRelayer) public {}

    /**
     * @notice Returns ancillary data containing all relevant Relay data that voters can format into UTF8 and use to
     * determine if the relay is valid.
     * @param _relayData Contains relevant relay data.
     * @return bytes New ancillary data that can be decoded into UTF8.
     */
    function getRelayAncillaryData(RelayAncillaryDataContents memory _relayData) public view returns (bytes memory) {
        bytes memory intermediateAncillaryData = "";

        // Add relay data inferred from the original deposit on L2:
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "depositId",
            _relayData.depositId
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
            _relayData.depositTimestamp
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
            _relayData.maxFeePct
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "proposerRewardPct",
            _relayData.proposerRewardPct
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "realizedFeePct",
            _relayData.realizedFeePct
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
            bridgePoolFactory.depositContract()
        );

        return intermediateAncillaryData;
    }

    /**********************
     * Internal Functions *
     **********************/

    function _getOptimisticOracle() private view returns (OptimisticOracleInterface) {
        return
            OptimisticOracleInterface(
                FinderInterface(bridgePoolFactory.finder()).getImplementationAddress(OracleInterfaces.OptimisticOracle)
            );
    }

    function _getStore() private view returns (StoreInterface) {
        return
            StoreInterface(
                FinderInterface(bridgePoolFactory.finder()).getImplementationAddress(OracleInterfaces.Store)
            );
    }

    function _requestOraclePriceRelay(
        address l1Token,
        uint256 amount,
        uint256 requestTimestamp,
        bytes memory customAncillaryData,
        uint256 proposerRewardPct
    ) private {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
        uint256 proposerBondPct =
            FixedPoint.Unsigned(bridgePoolFactory.proposerBondPct()).div(FixedPoint.fromUnscaledUint(1)).rawValue;

        // Optimistic oracle will pull proposer reward from passive LP pool.
        uint256 proposerReward =
            FixedPoint
                .Unsigned(proposerRewardPct)
                .div(FixedPoint.fromUnscaledUint(1))
                .mul(FixedPoint.Unsigned(amount))
                .rawValue;

        // Sanity check that pool balance is enough to cover relay amount + proposer reward.
        require(IERC20(l1Token).balanceOf(address(this)) >= amount + proposerReward, "Insufficient pool balance");

        IERC20(l1Token).safeApprove(address(optimisticOracle), proposerReward);
        optimisticOracle.requestPrice(
            bridgePoolFactory.identifier(),
            requestTimestamp,
            customAncillaryData,
            IERC20(l1Token),
            proposerReward
        );

        // Set the Optimistic oracle liveness for the price request.
        optimisticOracle.setCustomLiveness(
            bridgePoolFactory.identifier(),
            requestTimestamp,
            customAncillaryData,
            bridgePoolFactory.optimisticOracleLiveness()
        );

        // Set the Optimistic oracle proposer bond for the price request.
        uint256 proposerBond = FixedPoint.Unsigned(proposerBondPct).mul(FixedPoint.Unsigned(amount)).rawValue;
        optimisticOracle.setBond(bridgePoolFactory.identifier(), requestTimestamp, customAncillaryData, proposerBond);
    }

    function _proposeOraclePriceRelay(
        address l1Token,
        uint256 amount,
        uint256 requestTimestamp,
        bytes memory customAncillaryData
    ) private {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();
        uint256 proposerBondPct =
            FixedPoint.Unsigned(bridgePoolFactory.proposerBondPct()).div(FixedPoint.fromUnscaledUint(1)).rawValue;
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
            bridgePoolFactory.identifier(),
            requestTimestamp,
            customAncillaryData,
            1e18
        );
    }
}
