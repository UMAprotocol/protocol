// SPDX-License-Identifier: AGPL-3.0-only

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../common/FundingRateApplier.sol";
import "../../common/implementation/FixedPoint.sol";
import "./Perpetual.sol";

/**
 * @dev This contract serves to wrap a Perpetual Token in such a way to transform it from a "cToken" to an "aToken".
 * To put that in different terms, this means to transform it from a token that accrues (or pays) interest by changing
 * _value_ to one that accrues (or pays) interest by changing balances.
 * Note: this contract was forked from the MIT-licensed OpenZeppelin ERC20 implementation.
 */
contract PerpetualTokenWrapper is ERC20 {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using FixedPoint for FixedPoint.Unsigned;

    mapping(address => uint256) private _deposits;

    mapping(address => mapping(address => uint256)) private _allowances;

    uint256 private _totalDeposits;
    IERC20 _wrappedToken;
    Perpetual _perpetual;

    /**
     * @dev Sets the values for {name} and {symbol}, initializes {decimals} with
     * a default value of 18.
     *
     * To select a different value for {decimals}, use {_setupDecimals}.
     *
     * All three of these values are immutable: they can only be set once during
     * construction.
     */
    constructor(
        string memory name,
        string memory symbol,
        address perpetual
    ) public ERC20(name, symbol) {
        _perpetual = Perpetual(perpetual);
        _wrappedToken = IERC20(_perpetual.tokenCurrency());
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view override returns (uint256) {
        return wrappedToBalance(_totalDeposits);
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(address account) public view override returns (uint256) {
        return wrappedToBalance(_deposits[msg.sender]);
    }

    function deposit(uint256 wrappedAmount) public {
        _deposits[msg.sender] = _deposits[msg.sender].add(wrappedAmount);
        _wrappedToken.safeTransferFrom(msg.sender, address(this), wrappedAmount);
        emit Transfer(address(0), msg.sender, wrappedToBalance(wrappedAmount));
    }

    function redeem(uint256 amount) public {
        uint256 wrappedAmount = balanceToWrapped(amount);
        _deposits[msg.sender] = _deposits[msg.sender].sub(wrappedAmount, "ERC20: decreased balance below zero");
        _wrappedToken.safeTransfer(msg.sender, wrappedAmount);
        emit Transfer(msg.sender, address(0), amount);
    }

    function balanceToWrapped(uint256 balance) public view returns (uint256) {
        return FixedPoint.Unsigned(balance).div(_perpetual.cumulativeFundingRateMultiplier()).rawValue;
    }

    function wrappedToBalance(uint256 wrapped) public view returns (uint256) {
        return FixedPoint.Unsigned(wrapped).mul(_perpetual.cumulativeFundingRateMultiplier()).rawValue;
    }

    /**
     * @dev Moves tokens `amount` from `sender` to `recipient`.
     *
     * This is internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     *
     * Requirements:
     *
     * - `sender` cannot be the zero address.
     * - `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount`.
     */
    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal virtual override {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");

        _beforeTokenTransfer(sender, recipient, amount);

        uint256 wrappedAmount = balanceToWrapped(amount);

        _deposits[sender] = _deposits[sender].sub(wrappedAmount, "ERC20: transfer amount exceeds balance");
        _deposits[recipient] = _deposits[recipient].add(wrappedAmount);
        emit Transfer(sender, recipient, amount);
    }
}
