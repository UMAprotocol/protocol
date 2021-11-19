// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../common/implementation/Lockable.sol";
import "./OptimisticRewarder.sol";
import "./OptimisticRewarderToken.sol";

contract OptimisticMintr is Lockable {
    using SafeERC20 for IERC20;

    OptimisticRewarderToken public token;
    OptimisticRewarderBase public optimisticRewarder;
    IERC20 public stakedToken;

    mapping(uint256 => uint256) public balances;

    constructor(
        OptimisticRewarderToken _token,
        OptimisticRewarderBase _optimisticRewarder,
        IERC20 _stakedToken
    ) {
        token = _token;
        optimisticRewarder = _optimisticRewarder;
        stakedToken = _stakedToken;
    }

    modifier onlyTokenOwner(uint256 tokenId) {
        require(token.ownerOf(tokenId) == msg.sender, "caller != token owner");
        _;
    }

    function deposit(uint256 tokenId, uint256 amount) public onlyTokenOwner(tokenId) {
        depositFor(tokenId, amount);
    }

    function depositFor(uint256 tokenId, uint256 amount) public nonReentrant {
        balances[tokenId] += amount;
        stakedToken.safeTransferFrom(msg.sender, address(this), amount);
        optimisticRewarder.updateToken(tokenId, msg.data);
    }

    function withdraw(uint256 tokenId, uint256 amount) public nonReentrant onlyTokenOwner(tokenId) {
        balances[tokenId] -= amount;
        stakedToken.safeTransfer(msg.sender, amount);
        optimisticRewarder.updateToken(tokenId, msg.data);
    }
}
