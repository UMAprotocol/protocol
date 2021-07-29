// SPDX-License-Identifier: AGPL-3.0-only

// Note that we use < 0.8 because `@eth-optimism` contracts use that version.
pragma solidity >=0.7.6;

import "@eth-optimism/contracts/libraries/bridge/OVM_CrossDomainEnabled.sol";
import "./OVM_BridgeDepositBox.sol";

interface OptimisticOracleInterface {
    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        IERC20 currency,
        uint256 reward
    ) external virtual returns (uint256 totalBond);

    function setBond(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 bond
    ) external virtual returns (uint256 totalBond);

    function setCustomLiveness(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        uint256 customLiveness
    ) external virtual;

    function proposePriceFor(
        address proposer,
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        int256 proposedPrice
    ) public virtual returns (uint256 totalBond);
}

interface IdentifierWhitelistHelper {
    function isIdentifierSupported(bytes32 identifier) external view returns (bool);
}

interface StoreHelper {
    function computeFinalFee(address currency) external view returns (FixedPoint.Unsigned memory);
}

interface AddressWhitelistHelper {
    function isOnWhitelist(address newElement) external view virtual returns (bool);
}

library OracleInterfaces {
    bytes32 public constant IdentifierWhitelist = "IdentifierWhitelist";
    bytes32 public constant Store = "Store";
    bytes32 public constant CollateralWhitelist = "CollateralWhitelist";
    bytes32 public constant OptimisticOracle = "OptimisticOracle";
}

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

/**
 * @notice Contract deployed on L1 that has an implicit reference to a DepositBox on L2 and provides methods for
 * "Relayers" to fulfill deposit orders to that contract. The Relayers can either post capital to fulfill the deposit
 * instantly, or request that the funds are taken out of the passive liquidity provider pool following a challenge period.
 * @dev A "Deposit" is an order to send capital from L2 to L1, and a "Relay" is a fulfillment attempt of that order.
 */
contract BridgeRouter is OVM_CrossDomainEnabled {
    using SafeERC20 for IERC20;

    // Finder used to point to latest OptimisticOracle and other DVM contracts.
    address public finder;

    // L2 Deposit contract that originates deposits that can be fulfilled by this contract.
    address public depositContract;

    // L1 token addresses are mapped to their canonical token address on L2 and the BridgePool contract that houses
    // relay liquidity for any deposits of the canonical L2 token.
    struct L1TokenRelationships {
        address l2Token;
        address bridgePool;
        uint256 proposerReward;
        uint256 proposerBond;
    }
    mapping(address => L1TokenRelationships) public whitelistedTokens;

    // Set upon construction and can be reset by Owner.
    uint256 public optimisticOracleLiveness;
    uint256 public optimisticOracleProposalReward;
    bytes32 public identifier;

    // A Deposit represents a transfer that originated on an L2 DepositBox contract and can be bridged via this contract.
    enum DepositState { Uninitialized, PendingSlow, PendingInstant, FinalizedSlow, FinalizedInstant }
    enum DepositType { Slow, Instant }

    struct Deposit {
        DepositState depositState;
        DepositType depositType;
        // The following params are set by the L2 depositor:
        address l1Recipient;
        address l2Token;
        uint256 amount;
        uint256 maxFee;
        // Params inferred by this contract:
        address l1Token;
        // The following params are inferred and set by the L2 deposit contract:
        address l2Sender;
        address depositContract;
        uint256 depositTimestamp;
        // Relayer will compute the realized fee considering the amount of liquidity in this contract and the pending
        // withdrawals at the depositTimestamp.
        uint256 realizedFee;
        // A deposit can have both a slow and an instant relayer if a slow relay is "sped up" from slow to instant. In
        // these cases, we want to store both addresses for separate payouts.
        address slowRelayer;
        address instantRelayer;
        // TODO: Not sure how this will be used or why its stored but its in the interface doc
        bytes priceRequestAncillaryData;
    }
    // Associates each deposit with a unique ID.
    mapping(uint256 => Deposit) public deposits;
    // If a deposit is disputed, it is removed from the `deposits` mapping and added to the `disputedDeposits` mapping.
    // There can only be one disputed deposit per relayer for each deposit ID.
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

    // TODO: We can't use @openzeppelin/Ownable until we bump this contract to Solidity 0.8
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    address public owner;
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(
        address _finder,
        address _crossDomainMessenger,
        address _owner,
        uint256 _optimisticOracleLiveness,
        uint256 _optimisticOracleProposalReward,
        bytes32 _identifier
    ) OVM_CrossDomainEnabled(_crossDomainMessenger) {
        finder = _finder;
        require(address(_getOptimisticOracle()) != address(0), "Invalid finder");
        owner = _owner;
        optimisticOracleLiveness = _optimisticOracleLiveness;
        optimisticOracleProposalReward = _optimisticOracleProposalReward;
        _setIdentifier(_identifier);
    }

    // Admin functions

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions anymore. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby removing any functionality that is only available to the owner.
     */
    function renounceOwnership() public onlyOwner {
        _setOwner(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        _setOwner(newOwner);
    }

    /**
     * @dev Sets new price identifier to use for relayed deposits.
     * Can only be called by the current owner.
     */
    function setIdentifier(bytes32 _identifier) public onlyOwner {
        _setIdentifier(_identifier);
    }

    /**
     * @notice Privileged account can set L2 deposit contract that originates deposit orders to be fulfilled by this
     * contract.
     * @dev Only callable by Owner of this contract.
     * @param _depositContract Address of L2 deposit contract.
     */
    function setDepositContract(address _depositContract) public onlyOwner {
        depositContract = _depositContract;
        emit SetDepositContract(depositContract);
    }

    /**
     * @notice Privileged account can associate a whitelisted token with its linked token address on L2 and its
     * BridgePool address on this network. The linked L2 token can thereafter be deposited into the Deposit contract
     * on L2 and relayed via this contract denominated in the L1 token.
     * @dev Only callable by Owner of this contract. Also initiates a cross-chain call to the L2 Deposit contract to
     * whitelist the token mapping.
     * @param _l1Token Address of L1 token that can be used to relay L2 token deposits.
     * @param _l2Token Address of L2 token whose deposits are fulfilled by `_l1Token`.
     * @param _bridgePool Address of pool contract that stores passive liquidity with which to fulfill deposits.
     * @param _l2Gas Gas limit to set for relayed message on L2
     * @param _proposalReward Proposal reward to pay relayers of this L2->L1 relay.
     * @param _proposalBond Proposal bond that relayers must pay to relay deposits for this L2->L1 relay.
     */
    function whitelistToken(
        address _l1Token,
        address _l2Token,
        address _bridgePool,
        uint32 _l2Gas,
        uint256 _proposalReward,
        uint256 _proposalBond
    ) public onlyOwner {
        require(_getCollateralWhitelist().isOnWhitelist(address(_l1Token)), "Payment token not whitelisted");
        // TODO: Is this check required? Are we OK if a token mapping is whitelisted on this contract but not on the
        // corresponding L2 contract?
        require(depositContract != address(0), "Deposit contract not set");

        L1TokenRelationships storage whitelistedToken = whitelistedTokens[_l1Token];
        whitelistedToken.l2Token = _l2Token;
        whitelistedToken.bridgePool = _bridgePool;
        whitelistedToken.proposerReward = _proposalReward;
        whitelistedToken.proposerBond = _proposalBond;
        sendCrossDomainMessage(
            depositContract,
            _l2Gas,
            abi.encodeWithSignature("whitelistToken(address,address)", _l1Token, whitelistedToken.l2Token)
        );
        emit WhitelistToken(
            _l1Token,
            whitelistedToken.l2Token,
            whitelistedToken.bridgePool,
            whitelistedToken.proposerReward,
            whitelistedToken.proposerBond
        );
    }

    // TODO:
    // function pauseL2Deposits() public onlyOwner {}

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
        Deposit storage deposit = deposits[depositId];
        require(deposit.state == DepositState.Uninitialized, "Pending relay for deposit ID exists");
        Deposit storage disputedDeposit = disputedDeposits[depositId][msg.sender];
        require(
            disputedDeposit.state == DepositState.Uninitialized,
            "Pending dispute by relayer for deposit ID exists"
        );

        // TODO: Revisit these OO price request params.
        uint256 requestTimestamp = now;
        bytes32 customAncillaryData = bytes("0xTODO");

        // Store new deposit:
        deposit.depositState = DepositState.PendingSlow;
        deposit.depositType = DepositType.Slow;
        deposit.l1Recipient = recipient;
        deposit.l2Token = whitelistedToken[l1Token].l2Token;
        deposit.amount = amount;
        deposit.maxFee = maxFee;
        deposit.l1Token = l1Token;
        deposit.l2Sender = l2Sender;
        deposit.depositContract = depositContract;
        deposit.depositTimestamp = depositTimestamp;
        deposit.realizedFee = realizedFee;
        deposit.slowRelayer = msg.sender;
        deposit.priceRequestAncillaryData = customAncillaryData = bytes("0xTODO");

        // Request a price for the relay identifier and propose "true" optimistically.
        uint256 proposalReward = whitelistedToken[l1Token].proposalReward;
        _requestOraclePriceRelay(l1Token, requestTimestamp, customAncillaryData, proposalReward);
        uint256 proposalBond = whitelistedToken[l1Token].proposalBond;
        _proposeOraclePriceRelay(l1Token, requestTimestamp, customAncillaryData, proposalBond);

        emit DepositRelayed(
            l2Sender,
            recipient,
            whitelistedToken[l1Token].l2Token,
            l1Token,
            msg.sender,
            amount,
            depositContract,
            realizedFee,
            maxFee
        );
    }

    function speedUpRelay(uint256 depositId) public {}

    function finalizeRelay(uint256 depositId) public {}

    function settleDisputedRelay(uint256 depositId, address slowRelayer) public {}

    // Internal functions

    function _getOptimisticOracle() private view returns (OptimisticOracleInterface) {
        return OptimisticOracleInterface(finder.getImplementationAddress(OracleInterfaces.OptimisticOracle));
    }

    function _getIdentifierWhitelist() private view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    function _getCollateralWhitelist() private view returns (AddressWhitelistInterface) {
        return AddressWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    function _getStore() private view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    function _setOwner(address newOwner) private {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function _setIdentifier(bytes32 _identifier) private {
        require(_getIdentifierWhitelist().isIdentifierSupported(_identifier), "Identifier not registered");
        // TODO: Should we validate this _identifier? Perhaps check that its not 0x?
        identifier = _identifier;
    }

    function _requestOraclePriceRelay(
        address l1Token,
        uint256 requestTimestamp,
        bytes32 customAncillaryData,
        uint256 proposalReward
    ) private {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();

        uint256 finalFee = _getStore().computeFinalFee(address(currency)).rawValue;

        // This will pull the proposal reward from the caller.
        if (proposalReward > 0)
            TokenHelper.safeTransferFrom(l1Token, msg.sender, address(optimisticOracle), proposalReward);
        optimisticOracle.requestPrice(identifier, requestTimestamp, customAncillaryData, l1Token, proposalReward);

        // Set the Optimistic oracle liveness for the price request.
        optimisticOracle.setCustomLiveness(identifier, requestTimestamp, customAncillaryData, optimisticOracleLiveness);

        // Set the Optimistic oracle proposer bond for the price request.
        // TODO: Assume proposal reward == proposal bond
        optimisticOracle.setBond(identifier, requestTimestamp, customAncillaryData, proposalReward);
    }

    function _proposeOraclePriceRelay(
        address l1Token,
        uint256 requestTimestamp,
        bytes32 customAncillaryData
    ) private {
        OptimisticOracleInterface optimisticOracle = _getOptimisticOracle();

        uint256 proposalBond = whitelistedToken[l1Token].proposerBond;
        uint256 finalFee = _getStore().computeFinalFee(address(l1Token)).rawValue;
        uint256 totalBond = proposalBond.add(finalFee);

        // This will pull the total bond from the caller.
        TokenHelper.safeTransferFrom(l1Token, msg.sender, address(optimisticOracle), totalBond);
        proposePriceFor(msg.sender, msg.sender, identifier, requestTimestamp, customAncillaryData, 1);
    }
}
