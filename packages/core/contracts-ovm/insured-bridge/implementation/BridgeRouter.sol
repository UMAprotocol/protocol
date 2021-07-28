// SPDX-License-Identifier: AGPL-3.0-only

// Note that we use < 0.8 because `@eth-optimism` contracts use that version.
pragma solidity >=0.7.6;

import "@eth-optimism/contracts/libraries/bridge/OVM_CrossDomainEnabled.sol";

import "./OVM_BridgeDepositBox.sol";

/**
 * @notice Contract deployed on L1 that has an implicit reference to a DepositBox on L2 and provides methods for
 * "Relayers" to fulfill deposit orders to that contract. The Relayers can either post capital to fulfill the deposit
 * instantly, or request that the funds are taken out of the passive liquidity provider pool following a challenge period.
 * @dev A "Deposit" is an order to send capital from L2 to L1, and a "Relay" is a fulfillment attempt of that order.
 */
contract BridgeRouter is OVM_CrossDomainEnabled {
    // Finder used to point to latest OptimisticOracle and other DVM contracts.
    address public finder;

    // L2 Deposit contract that originates deposits that can be fulfilled by this contract.
    address public depositContract;

    // L1 token addresses are mapped to their canonical token address on L2 and the BridgePool contract that houses
    // relay liquidity for any deposits of the canonical L2 token.
    struct L1TokenRelationships {
        address l2Token;
        address bridgePool;
    }
    mapping(address => L1TokenRelationships) public whitelistedTokens;

    // Set upon construction and can be reset by Owner.
    uint256 public optimisticOracleLiveness;

    // A Deposit represents a transfer that originated on an L2 DepositBox contract and can be bridged via this contract.
    enum DepositState { PendingSlow, PendingInstant, FinalizedSlow, FinalizedInstant }
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
    // There can only be one disputed deposit for each deposit ID.
    mapping(uint256 => Deposit) public disputedDeposits;

    event SetDepositContract(address indexed l2DepositContract);
    event WhitelistToken(address indexed l1Token, address indexed l2Token, address indexed bridgePool);
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
        uint256 _optimisticOracleLiveness
    ) OVM_CrossDomainEnabled(_crossDomainMessenger) {
        finder = _finder;
        owner = _owner;
        optimisticOracleLiveness = _optimisticOracleLiveness;
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
     * @dev Only callable by Owner of this contract.
     * @param _l1Token Address of L1 token that can be used to relay L2 token deposits.
     * @param _l2Token Address of L2 token whose deposits are fulfilled by `_l1Token`.
     * @param _bridgePool Address of pool contract that stores passive liquidity with which to fulfill deposits.
     */
    function whitelistToken(
        address _l1Token,
        address _l2Token,
        address _bridgePool
    ) public onlyOwner {
        L1TokenRelationships storage whitelistedToken = whitelistedTokens[_l1Token];
        whitelistedToken.l2Token = _l2Token;
        whitelistedToken.bridgePool = _bridgePool;
        emit WhitelistToken(_l1Token, whitelistedToken.l2Token, whitelistedToken.bridgePool);
    }

    // TODO:
    // function pauseL2Deposits() public onlyOwner {}

    // Liquidity provider functions

    function deposit(address l1Token, uint256 amount) public {}

    function withdraw(address lpToken, uint256 amount) public {}

    // Relayer functions

    function relayDeposit(
        uint256 depositId,
        uint256 depositTimestamp,
        address recipient,
        address l2Token,
        uint256 amount,
        uint256 realizedFee,
        uint256 maxFee
    ) public {}

    function speedUpRelay(uint256 depositId) public {}

    function finalizeRelay(uint256 depositId) public {}

    function settleDisputedRelay(uint256 depositId, address slowRelayer) public {}

    // Internal functions
    function _setOwner(address newOwner) private {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}
