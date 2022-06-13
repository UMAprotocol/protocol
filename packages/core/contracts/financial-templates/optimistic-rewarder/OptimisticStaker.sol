// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/MultiCaller.sol";
import "./OptimisticRewarderBase.sol";

/**
 * @notice An example use case of the OptimisticRewarder in use by a contract that allows users to stake an ERC20 to
 * earn rewards.
 */
contract OptimisticStaker is Lockable, MultiCaller {
    using SafeERC20 for IERC20;

    // Optimistic rewarder contract used to pay out user rewards.
    OptimisticRewarderBase public optimisticRewarder;

    // Staked ERC20 token.
    IERC20 public stakedToken;

    // Balances by tokenId.
    mapping(uint256 => uint256) public balances;

    event Deposit(uint256 indexed tokenId, uint256 amount);
    event Withdraw(uint256 indexed tokenId, uint256 amount);

    /**
     * @notice Constructor.
     * @param _optimisticRewarder Optimistic rewarder contract used to pay out user rewards.
     * @param _stakedToken staked ERC20 token.
     */
    constructor(OptimisticRewarderBase _optimisticRewarder, IERC20 _stakedToken) {
        optimisticRewarder = _optimisticRewarder;
        stakedToken = _stakedToken;
    }

    modifier onlyTokenOwner(uint256 tokenId) {
        require(optimisticRewarder.ownerOf(tokenId) == msg.sender, "caller != token owner");
        _;
    }

    /**
     * @notice Deposit the staked token into the contract and mint a fresh token to manage the position.
     * @param amount the amount of the ERC20 to deposit.
     * @return tokenId the token id for the freshly minted token.
     */
    function depositNew(uint256 amount) public nonReentrant returns (uint256 tokenId) {
        tokenId = optimisticRewarder.mint(msg.sender, msg.data);
        _depositFor(tokenId, amount);
    }

    /**
     * @notice Deposit the staked token into the contract.
     * @param tokenId the tokenId that will own this liquidity. User must be the owner of this tokenId.
     * @param amount the amount of the ERC20 to deposit.
     */
    function deposit(uint256 tokenId, uint256 amount) public nonReentrant onlyTokenOwner(tokenId) {
        _depositFor(tokenId, amount);
    }

    /**
     * @notice Deposit staked tokens on behalf of a tokenId that the user may not control.
     * @param tokenId the tokenId that will own this liquidity.
     * @param amount the amount of the ERC20 to deposit.
     */
    function depositFor(uint256 tokenId, uint256 amount) public nonReentrant {
        _depositFor(tokenId, amount);
    }

    /**
     * @notice Withdraw the staked tokens.
     * @param tokenId the tokenId that owns this liquidity. User must own this tokenId.
     * @param amount the amount of the ERC20 to withdraw.
     */
    function withdraw(uint256 tokenId, uint256 amount) public nonReentrant onlyTokenOwner(tokenId) {
        balances[tokenId] -= amount;
        stakedToken.safeTransfer(msg.sender, amount);
        optimisticRewarder.updateToken(tokenId, msg.data);
        emit Withdraw(tokenId, amount);
    }

    function _depositFor(uint256 tokenId, uint256 amount) internal {
        balances[tokenId] += amount;
        stakedToken.safeTransferFrom(msg.sender, address(this), amount);
        optimisticRewarder.updateToken(tokenId, msg.data);
        emit Deposit(tokenId, amount);
    }
}
