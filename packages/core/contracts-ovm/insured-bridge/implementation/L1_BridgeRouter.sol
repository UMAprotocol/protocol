// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.7.6;

import "@eth-optimism/contracts/libraries/bridge/OVM_CrossDomainEnabled.sol";

import "./L2_BridgeDepositBox.sol";

/**
 * @notice Contract deployed on L1 that has an implicit reference to a DepositBox on L2 and provides methods for
 * "Relayers" to fulfill deposit orders to that contract. The Relayers can either post capital to fulfill the deposit
 * instantly, or request that the funds are taken out of the passive liquidity provider pool following a challenge period.
 * @dev A "Deposit" is an order to send capital from L2 to L1, and a "Relay" is a fulfillment attempt of that order.
 */
contract BridgeRouter is OVM_CrossDomainEnabled {
    // Finder used to point to latest OptimisticOracle and other DVM contracts.
    address public finder;

    // Deposit contract that originates deposits that can be fulfilled by this contract.
    address depositContract;

    // Links L2-L1 addresses between canonical versions of the same token for each network. For example, if the
    // official address of WETH on L2 is 0x123 and the official address of WETH on L1 is 0xabc, then the mapping will
    // be (0x123 => 0xabc).
    mapping(address => address) public whitelistedTokens;

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
    mapping(uint256 => Deposit) deposits;

    event SetDepositContract(address indexed l2DepositContract);
    event WhitelistToken(address indexed l2Token, address indexed l1Token);
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

    function setDepositContract(address depositContract) public onlyOwner {}

    function whitelistToken(address l1Token, address l2Token) public onlyOwner {}

    function pauseL2Deposits() public onlyOwner {}

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
}
