// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./BridgeAdminInterface.sol";
import "./BridgePoolInterface.sol";

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
 * The Relayers can either post capital to fulfill the deposit instantly, or request that the funds are taken out of
 * a passive liquidity provider pool following a challenge period. Related, this contract ingests liquidity from
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
    uint256 public utilizedReserves;

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
    event SettledRelay(
        bytes32 indexed depositHash,
        bytes32 indexed priceRequestAncillaryDataHash,
        address indexed caller
    );

    event LiquidityAdded(address indexed token, uint256 amount, uint256 lpTokensMinted, address liquidityProvider);
    event LiquidityRemoved(address indexed token, uint256 amount, uint256 lpTokensBurnt, address liquidityProvider);

    modifier onlyFromOptimisticOracle() {
        require(msg.sender == address(_getOptimisticOracle()), "Caller must be OptimisticOracle");
        _;
    }

    // TODO: should we consider changing the name of the LP token as a function of the l1Token? if so, might not be able
    // to do this with this contract inheriting from expanded ERC20 or might need this contract to have an instance
    // of the LPToken.
    constructor(
        address _bridgeAdmin,
        address _l1Token,
        address _timer
    ) Testable(_timer) ExpandedERC20("UMA Insured Bride LP Token", "UMA-LP", 18) {
        bridgeAdmin = BridgeAdminInterface(_bridgeAdmin);
        require(bridgeAdmin.finder() != address(0), "Invalid bridge pool factory");

        l1Token = IERC20(_l1Token);
    }

    /*************************************************
     *          LIQUIDITY PROVIDER FUNCTIONS         *
     *************************************************/

    function addLiquidity(uint256 l1TokenAmount) public {
        l1Token.safeTransferFrom(msg.sender, address(this), l1TokenAmount);

        uint256 lpTokensToMint =
            FixedPoint.Unsigned(l1TokenAmount).div(FixedPoint.Unsigned(exchangeRateCurrent())).rawValue;

        _mint(msg.sender, lpTokensToMint);

        liquidReserves += l1TokenAmount;

        emit LiquidityAdded(address(l1Token), l1TokenAmount, lpTokensToMint, msg.sender);
    }

    function removeLiquidity(uint256 lpTokenAmount) public {
        //TODO: consider pending utilized funds(slow transfers waiting liveness) in allowing withdraws.
        uint256 l1TokensToReturn =
            FixedPoint.Unsigned(lpTokenAmount).mul(FixedPoint.Unsigned(exchangeRateCurrent())).rawValue;

        _burn(msg.sender, lpTokenAmount);

        liquidReserves -= l1TokensToReturn;

        l1Token.safeTransfer(msg.sender, l1TokensToReturn);

        emit LiquidityRemoved(address(l1Token), l1TokensToReturn, lpTokenAmount, msg.sender);
    }

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
                l1Token: address(l1Token),
                amount: amount,
                maxFeePct: maxFeePct
            });
        bytes32 depositHash = _getDepositHash(depositData);
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
            l1Token.balanceOf(address(this)) >= amount + _getProposerRewardAmount(proposerRewardPct, amount),
            "Insufficient pool balance"
        );

        // Request a price for the relay identifier and propose "true" optimistically. These methods will pull the
        // (proposer reward + proposer bond + final fee) from the caller.
        // Note: We need to set a new price request timestamp instead of default setting to equal to the
        // `depositTimestamp`, which is dependent on the L2 VM on which the DepositContract is deployed. Imagine if
        // the timestamps on the L2 have an offset that are always "in the future" relative to L1 blocks, then the
        // OptimisticOracle would always reject requests.
        _requestOraclePriceRelay(amount, priceRequestTime, getRelayAncillaryData(depositData, relayData));
        _proposeOraclePriceRelay(amount, priceRequestTime, getRelayAncillaryData(depositData, relayData));

        // We use an internal method to emit this event to overcome Solidity's "stack too deep" error.
        _emitDepositRelayedEvent(depositData, keccak256(getRelayAncillaryData(depositData, relayData)), depositHash);
    }

    /**
     * @notice Instantly relay a deposit amount minus fees. Instant relayer earns a reward following the pending relay
     * challenge period.
     * @dev Caller must have approved this contract to spend the deposit amount of L1 tokens to relay. There can only
     * be one instant relayer per relay attempt and disputed relays cannot be sped up.
     * @param _depositData Unique set of L2 deposit data that caller is trying to instantly relay.
     */
    function speedUpRelay(DepositData memory _depositData) public {
        bytes32 depositHash = _getDepositHash(_depositData);
        RelayData storage relay = relays[depositHash];
        require(relays[depositHash].relayState == RelayState.Pending, "Can only speed up pending slow relay");
        require(relays[depositHash].instantRelayer == address(0), "Relay has already been instant relayed");
        relay.instantRelayer = msg.sender;

        // Pull relay amount minus fees from caller.
        l1Token.safeTransferFrom(
            msg.sender,
            address(this),
            _depositData.amount - _getRealizedFeeAmount(relay.realizedFeePct, _depositData.amount)
        );

        emit RelaySpedUp(depositHash, msg.sender);

        // Note that in a sped up relay we dont need to increment/decrement any utilization numbers as the liquidity
        // used is the fast relayers, not the LPs. Only at the settlement of the relay do we modify these numbers.
    }

    /**
     * @notice Reward relayers if a pending relay price request has a price available on the OptimisticOracle. Mark
     * the relay as complete.
     * @param _depositData Unique set of L2 deposit data that caller is trying to settle a relay for.
     */
    function settleRelay(DepositData memory _depositData) public {
        bytes32 depositHash = _getDepositHash(_depositData);
        RelayData storage relay = relays[depositHash];

        require(relays[depositHash].relayState == RelayState.Pending, "Only pending state can be settled");
        // Note `hasPrice` will return false if liveness has not been passed in the optimistic oracle.

        require(
            _getOptimisticOracle().hasPrice(
                address(this),
                bridgeAdmin.identifier(),
                relay.priceRequestTime,
                getRelayAncillaryData(_depositData, relay)
            ),
            "OptimisticOracle has not resolved relay price request"
        );

        // Note: Why don't we have to check the value of the price?
        // - If the OptimisticOracle has a price and the relayState is PENDING, then we can safely assume that the relay
        // was validated. This is because this contract proposes a price of 1e18, or "YES" to the identifier posing the
        // question "Is this relay valid for the associated deposit?". If the proposal is disputed, then the relayState
        // will be reset to UNINITIALIZED. If the proposal is not disputed, and there is a price available, then the
        // proposal must have passed the dispute period, assuming the proposal passed optimistic oracle liveness.

        relay.relayState = RelayState.Finalized;

        // Pay recipient the deposit amount less fees.
        uint256 recipientAmount =
            _depositData.amount - _getRealizedFeeAmount(relay.realizedFeePct, _depositData.amount);
        l1Token.safeTransfer(_depositData.recipient, recipientAmount);

        // Reward relayers.
        // TODO: For now, if there was an instant relay associated with this deposit, then split the reward 50/50
        // between slow and instant relayer. Otherwise pay the slow relayer the full reward.
        uint256 rewardPool = _getProposerRewardAmount(relay.proposerRewardPct, _depositData.amount);
        // Depending on the if there is an instant relayer set or not, branch to payout accordingly.
        if (relay.instantRelayer != address(0)) {
            IERC20(_depositData.l1Token).safeTransfer(
                relay.instantRelayer,
                FixedPoint
                    .Unsigned(rewardPool)
                    .mul(FixedPoint.fromUnscaledUint(1))
                    .div(FixedPoint.fromUnscaledUint(2))
                    .rawValue
            );
            l1Token.safeTransfer(
                relay.slowRelayer,
                FixedPoint
                    .Unsigned(rewardPool)
                    .mul(FixedPoint.fromUnscaledUint(1))
                    .div(FixedPoint.fromUnscaledUint(2))
                    .rawValue
            );
        } else {
            l1Token.safeTransfer(relay.slowRelayer, rewardPool);
        }

        uint256 totalOutflow = recipientAmount + rewardPool;

        utilizedReserves += totalOutflow;
        liquidReserves -= totalOutflow;

        emit SettledRelay(depositHash, keccak256(getRelayAncillaryData(_depositData, relay)), msg.sender);
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

    /************************************
     *           View FUNCTIONS         *
     ************************************/

    /**
     * @notice Computes the exchange rate between LP tokens and L1Tokens. Used when adding/removing liquidity.
     */
    function exchangeRateCurrent() public returns (uint256) {
        if (totalSupply() == 0) return 1e18; //initial rate is 1 pre any mint action.

        // First, update local accounting of finalized transfers from L2->L1.
        sync();

        // Consider a naive rate implementation. This acts like a step function, increasing when funds hit L1 from the
        // canonical bridge. TODO: update with a more elaborate technique that pays out gradually over the 1 week loan.
        return
            FixedPoint
                .fromUnscaledUint(liquidReserves)
                .add(FixedPoint.fromUnscaledUint(utilizedReserves))
                .div(FixedPoint.fromUnscaledUint(totalSupply()))
                .rawValue;
    }

    /**
     * @notice At the conclusion of an L2->L1 token transfer via the canonical token bridge, tokens will appear in this
     * contract. This method checks if the l1Token balance of the contract is greater than the liquidReserves. If it
     * is then the bridging action from L2->L1 has concluded and the local accounting can be updated.
     */
    function sync() public {
        uint256 l1TokenBalance = l1Token.balanceOf(address(this));
        uint256 bridgedAmount = l1TokenBalance - liquidReserves;
        if (bridgedAmount > 0) {
            // utilizedReserves can never be zero. If all pending transfers are done then this equals zero.
            utilizedReserves = utilizedReserves > bridgedAmount ? utilizedReserves - bridgedAmount : 0;
            liquidReserves = l1TokenBalance;
        }
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

    function _getRealizedFeeAmount(uint64 _realizedFeePct, uint256 _amount) private pure returns (uint256) {
        return
            FixedPoint
                .Unsigned(uint256(_realizedFeePct))
                .div(FixedPoint.fromUnscaledUint(1))
                .mul(FixedPoint.Unsigned(_amount))
                .rawValue;
    }

    function _getDepositHash(DepositData memory _depositData) private pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _depositData.depositTimestamp,
                    _depositData.maxFeePct,
                    _depositData.depositId,
                    _depositData.amount,
                    _depositData.l2Sender,
                    _depositData.recipient,
                    _depositData.l1Token
                )
            );
    }

    function _requestOraclePriceRelay(
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
