// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inspired by:
 * - https://github.com/pie-dao/vested-token-migration-app
 * - https://github.com/Uniswap/merkle-distributor
 * - https://github.com/balancer-labs/erc20-redeemable
 *
 */

pragma solidity ^0.6.0;

import "@openzeppelin/contracts/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/Testable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MerkleDistributor is Ownable, Lockable, Testable {
    // A Window contains a Merkle root, reward token address, and start time.
    // Claims for this window cannot take place before start time.
    struct Window {
        uint256 start;
        bytes32 merkleRoot;
        IERC20 rewardToken;
    }

    // Windows are mapped to arbitrary indices.
    mapping(uint256 => Window) public merkleWindows;
    // Keep track of claimants for each window.
    mapping(uint256 => mapping(address => bool)) public claimed;

    // Events:
    event Claimed(uint256 indexed windowIndex, address indexed account, uint256 amount, address indexed rewardToken);
    event SeededWindow(uint256 indexed windowIndex, uint256 amount, uint256 windowStart, address indexed rewardToken);

    constructor(address _timerAddress) public Testable(_timerAddress) {}

    // Set merkle root for a window and seed allocations.
    function setWindowMerkleRoot(
        uint256 windowIndex,
        uint256 totalWindowAmount,
        uint256 windowStart,
        address rewardTokenAddress,
        bytes32 merkleRoot
    ) external nonReentrant() onlyOwner {
        require(merkleWindows[windowIndex].merkleRoot == bytes32(0), "Root already set");
        Window storage window = merkleWindows[windowIndex];
        window.start = windowStart;
        window.merkleRoot = merkleRoot;
        window.rewardToken = IERC20(rewardTokenAddress);

        // TODO: How can we check that the `totalWindowAmount` is enough to cover all of the merkle root
        // disbursements?
        require(
            window.rewardToken.transferFrom(msg.sender, address(this), totalWindowAmount),
            "Seeding allocation failed"
        );
    }

    function claimWindow(
        address account,
        uint256 windowIndex,
        uint256 amount,
        bytes32[] memory merkleProof
    ) public nonReentrant() {
        require(!claimed[windowIndex][account], "Already claimed");
        require(verifyClaim(account, windowIndex, amount, merkleProof), "Incorrect merkle proof");

        claimed[windowIndex][account] = true;
        _disburse(account, amount, windowIndex);
    }

    function verifyClaim(
        address account,
        uint256 windowIndex,
        uint256 amount,
        bytes32[] memory merkleProof
    ) public view returns (bool valid) {
        bytes32 leaf = keccak256(abi.encodePacked(account, amount));
        return MerkleProof.verify(merkleProof, merkleWindows[windowIndex].merkleRoot, leaf);
    }

    function _disburse(
        address account,
        uint256 amount,
        uint256 windowIndex
    ) internal {
        if (amount > 0) {
            // Check that claim attempt is within window start and end time.
            uint256 currentContractTime = getCurrentTime();
            Window memory window = merkleWindows[windowIndex];
            require(currentContractTime >= window.start, "Invalid window time");
            require(window.rewardToken.transfer(account, amount), "Disbursement failed");
            emit Claimed(windowIndex, account, amount, address(window.rewardToken));
        }
    }

    // TODO: Enable vesting of distribution rewards within window. Would need to add endTime.
    // function calcVestedAmount(uint256 _amount, uint256 _time, uint256 _vestingStart, uint256 _vestingEnd) public view returns(uint256) {
    //     require(_time > _vestingStart, "WRONG TIME" );
    //     if (_time >= _vestingEnd) {
    //         return _amount;
    //     }
    //     //WARNING if _time == _start or _vested == _start, it will divide with zero
    //     return _amount.mul(_time.sub(_vestingStart)) / _vestingEnd.sub(_vestingStart);
    // }
}
