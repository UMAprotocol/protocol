// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./BridgePoolFactoryInterface.sol";
import "../../../contracts/oracle/interfaces/OptimisticOracleInterface.sol";
import "../../../contracts/oracle/interfaces/StoreInterface.sol";
import "../../../contracts/oracle/interfaces/FinderInterface.sol";
import "../../../contracts/oracle/implementation/Constants.sol";
import "../../../contracts/common/implementation/AncillaryData.sol";

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
contract BridgePool {
    using SafeERC20 for IERC20;

    // Administrative contract that deployed this contract and also houses all state variables needed to relay deposits.
    BridgePoolFactoryInterface bridgePoolFactory;

    // L1 token addresses are mapped to their canonical token address on L2 and the BridgePool contract that houses
    // relay liquidity for any deposits of the canonical L2 token.
    struct L1TokenRelationships {
        address l2Token;
        address bridgePool;
        uint256 proposerRewardPct;
        uint256 proposerBondPct;
    }

    // A Deposit represents a transfer that originated on an L2 DepositBox contract and can be bridged via this contract.
    enum DepositState { Uninitialized, PendingSlow, PendingInstant, FinalizedSlow, FinalizedInstant }
    enum DepositType { Slow, Instant }

    // @dev: There is a limit to how many params a struct can contain. Without encapsulating some of the Deposit params
    // inside the RelayAncillaryDataContents struct, the compiler throws an error related to this issue:
    // https://github.com/ethereum/solidity/issues/10930.
    struct RelayAncillaryDataContents {
        uint256 depositId;
        // The following params are inferred by the L2 deposit:
        address l2Sender;
        address recipient;
        uint256 depositTimestamp;
        address l1Token;
        uint256 amount;
        uint256 maxFee;
        // Relayer will compute the realized fee considering the amount of liquidity in this contract and the pending
        // withdrawals at the depositTimestamp.
        uint256 realizedFee;
        address relayer;
    }
    struct Deposit {
        DepositState depositState;
        DepositType depositType;
        // A deposit can have both a slow and an instant relayer if a slow relay is "sped up" from slow to instant. In
        // these cases, we want to store both addresses for separate payouts.
        address slowRelayer;
        address instantRelayer;
        // @dev: See @dev note above about why some Deposit params are collapsed into `RelayAncillaryDataContents`.
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

    event SetDepositContract(address indexed l2DepositContract);
    event WhitelistToken(
        address indexed l1Token,
        address indexed l2Token,
        address indexed bridgePool,
        uint256 proposalReward,
        uint256 proposalBond
    );
    event DepositRelayed(
        address indexed sender,
        address recipient,
        address indexed l2Token,
        address indexed l1Token,
        address relayer,
        uint256 amount,
        address depositContract,
        uint256 realizedFee,
        uint256 maxFee
    );
    event RelaySpedUp(uint256 indexed depositId, address indexed fastRelayer, address indexed slowRelayer);
    event FinalizedRelay(uint256 indexed depositId, address indexed caller);
    event RelayDisputeSettled(uint256 indexed depositId, address indexed caller, bool disputeSuccessful);
    event ProvidedLiquidity(address indexed token, uint256 amount, uint256 lpTokensMinted, address liquidityProvider);

    constructor(address _bridgePoolFactory) {
        bridgePoolFactory = BridgePoolFactoryInterface(_bridgePoolFactory);
        // TODO: Validate BridgePoolFactoryInterface.
    }

    // Liquidity provider functions

    function deposit(address l1Token, uint256 amount) public {}

    function withdraw(address lpToken, uint256 amount) public {}

    // Relayer functions

    /**
     * @notice Called by Relayer to execute Slow relay from L2 to L1, fulfilling a corresponding deposit order.
     * @dev There can only be one pending Slow relay for a deposit ID.
     * @dev Caller must have approved this contract to spend the final fee + proposer reward + proposer bond for `l1Token`.
     * @param depositId Unique ID corresponding to deposit order that caller wants to relay.
     * @param depositTimestamp Timestamp of Deposit emitted by L2 contract when order was initiated.
     * @param recipient Address on this network who should receive the relayed deposit.
     * @param l1Token Token currency to pay recipient. This contract stores a mapping of
     * `l1Token` to the canonical token currency on the L2 network that was deposited to the Deposit contract.
     * @param amount Deposited amount.
     * @param realizedFee Computed offchain by caller, considering the amount of available liquidity for the token
     * currency needed to pay the recipient and the count of pending withdrawals at the `depositTimestamp`. This fee
     * will be subtracted from the `amount`. If this value is computed incorrectly, then the relay can be disputed.
     * @param maxFee Maximum fee that L2 Depositor can pay. `realizedFee` <= `maxFee`.
     */
    function relayDeposit(
        uint256 depositId,
        uint256 depositTimestamp,
        address recipient,
        address l2Sender,
        address l1Token,
        uint256 amount,
        uint256 realizedFee,
        uint256 maxFee
    ) public {
        require(realizedFee <= maxFee, "Invalid realized fee");
        Deposit storage newDeposit = deposits[depositId];
        require(newDeposit.depositState == DepositState.Uninitialized, "Pending relay for deposit ID exists");
        Deposit storage disputedDeposit = disputedDeposits[depositId][msg.sender];
        require(
            disputedDeposit.depositState == DepositState.Uninitialized,
            "Pending dispute by relayer for deposit ID exists"
        );

        // TODO: Is this how the price request timestamp should be set?
        uint256 requestTimestamp = block.timestamp;
        RelayAncillaryDataContents memory newRelayData =
            RelayAncillaryDataContents({
                depositId: depositId,
                l2Sender: l2Sender,
                recipient: recipient,
                depositTimestamp: depositTimestamp,
                l1Token: l1Token,
                amount: amount,
                maxFee: maxFee,
                realizedFee: realizedFee,
                relayer: msg.sender
            });
        bytes memory customAncillaryData = _createRelayAncillaryData(newRelayData, msg.sender);

        // Store new deposit:
        newDeposit.depositState = DepositState.PendingSlow;
        newDeposit.depositType = DepositType.Slow;
        newDeposit.relayData = newRelayData;
        newDeposit.priceRequestAncillaryData = customAncillaryData;
        newDeposit.slowRelayer = msg.sender;

        // Request a price for the relay identifier and propose "true" optimistically. These methods will pull the
        // (proposer reward + proposer bond + final fee) from the caller.
        _requestOraclePriceRelay(l1Token, amount, requestTimestamp, customAncillaryData);
        _proposeOraclePriceRelay(l1Token, amount, requestTimestamp, customAncillaryData);

        emit DepositRelayed(
            l2Sender,
            recipient,
            bridgePoolFactory.getWhitelistedToken(l1Token).l2Token,
            l1Token,
            msg.sender,
            amount,
            bridgePoolFactory.getDepositContract(),
            realizedFee,
            maxFee
        );
    }

    function speedUpRelay(uint256 depositId) public {}

    function finalizeRelay(uint256 depositId) public {}

    function settleDisputedRelay(uint256 depositId, address slowRelayer) public {}

    // Internal functions

    function _getOptimisticOracle() private view returns (OptimisticOracleInterface) {
        return
            OptimisticOracleInterface(
                FinderInterface(bridgePoolFactory.getFinder()).getImplementationAddress(
                    OracleInterfaces.OptimisticOracle
                )
            );
    }

    function _getStore() private view returns (StoreInterface) {
        return
            StoreInterface(
                FinderInterface(bridgePoolFactory.getFinder()).getImplementationAddress(OracleInterfaces.Store)
            );
    }

    function _requestOraclePriceRelay(
        address l1Token,
        uint256 amount,
        uint256 requestTimestamp,
        bytes memory customAncillaryData
    ) private {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();

        uint256 proposerRewardPct = bridgePoolFactory.getWhitelistedToken(l1Token).proposerRewardPct;

        // Relayer should not have to pay the proposal reward, instead they should be receiving reward from the
        // Bridge Pool.
        uint256 proposerReward = proposerRewardPct * amount;
        if (proposerReward > 0) IERC20(l1Token).safeTransfer(address(optimisticOracle), proposerReward);
        optimisticOracle.requestPrice(
            bridgePoolFactory.getIdentifier(),
            requestTimestamp,
            customAncillaryData,
            IERC20(l1Token),
            proposerReward
        );

        // Set the Optimistic oracle liveness for the price request.
        optimisticOracle.setCustomLiveness(
            bridgePoolFactory.getIdentifier(),
            requestTimestamp,
            customAncillaryData,
            bridgePoolFactory.getOptimisticOracleLiveness()
        );

        // Set the Optimistic oracle proposer bond for the price request.
        // TODO: Assume proposal reward == proposal bond
        optimisticOracle.setBond(
            bridgePoolFactory.getIdentifier(),
            requestTimestamp,
            customAncillaryData,
            proposerReward
        );
    }

    function _proposeOraclePriceRelay(
        address l1Token,
        uint256 amount,
        uint256 requestTimestamp,
        bytes memory customAncillaryData
    ) private {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();

        uint256 proposerBondPct = bridgePoolFactory.getWhitelistedToken(l1Token).proposerBondPct;
        uint256 proposerBond = proposerBondPct * amount;
        uint256 finalFee = _getStore().computeFinalFee(address(l1Token)).rawValue;
        uint256 totalBond = proposerBond + finalFee;

        // This will pull the total bond from the caller.
        IERC20(l1Token).safeTransferFrom(msg.sender, address(optimisticOracle), totalBond);
        optimisticOracle.proposePriceFor(
            msg.sender,
            msg.sender,
            bridgePoolFactory.getIdentifier(),
            requestTimestamp,
            customAncillaryData,
            1
        );
    }

    function _createRelayAncillaryData(RelayAncillaryDataContents memory _relayData, address relayer)
        internal
        view
        returns (bytes memory)
    {
        bytes memory intermediateAncillaryData = bytes("0x");

        // Add relay data inferred from the original deposit on L2:
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "depositId",
            _relayData.depositId
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "depositTimestamp",
            _relayData.depositTimestamp
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "recipient",
            _relayData.recipient
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "l2Sender",
            _relayData.l2Sender
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
            "realizedFee",
            _relayData.realizedFee
        );
        intermediateAncillaryData = AncillaryData.appendKeyValueUint(
            intermediateAncillaryData,
            "maxFee",
            _relayData.maxFee
        );

        // Add parameterized data:
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(intermediateAncillaryData, "relayer", relayer);

        // Add global state data stored by this contract:
        intermediateAncillaryData = AncillaryData.appendKeyValueAddress(
            intermediateAncillaryData,
            "depositContract",
            bridgePoolFactory.getDepositContract()
        );

        return intermediateAncillaryData;
    }
}
