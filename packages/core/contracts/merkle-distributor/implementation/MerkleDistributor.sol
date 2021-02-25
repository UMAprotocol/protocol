// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inspired by:
 * - https://github.com/pie-dao/vested-token-migration-app
 * - https://github.com/Uniswap/merkle-distributor
 * - https://github.com/balancer-labs/erc20-redeemable
 *
 */

pragma solidity ^0.6.0;
// pragma experimental ABIEncoderV2;

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
        uint256 end;
        bytes32 merkleRoot;
        IERC20 rewardToken;
        uint256 totalRewardsDistributed;
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
        uint256 totalRewardsDistributed,
        uint256 windowStart,
        uint256 windowEnd,
        address rewardToken,
        bytes32 merkleRoot
    ) external nonReentrant() onlyOwner {
        require(merkleWindows[windowIndex].merkleRoot == bytes32(0), "Root already set");
        Window storage window = merkleWindows[windowIndex];
        window.start = windowStart;
        window.end = windowEnd;
        window.merkleRoot = merkleRoot;
        window.rewardToken = IERC20(rewardToken);
        window.totalRewardsDistributed = totalRewardsDistributed;

        // TODO: How can we check that the `totalRewardsDistributed` is enough to cover all of the merkle root
        // disbursements?

        require(
            window.rewardToken.transferFrom(msg.sender, address(this), totalRewardsDistributed),
            "Seeding allocation failed"
        );
    }

    // TODO: implement this method
    // function multiClaimWindow(
    //     uint256[] memory windowIndices,
    //     address[] memory accounts,
    //     uint256[] memory amounts,
    //     string[] memory metaData,
    //     bytes32[][] memory merkleProofs
    // ) public nonReentrant() {}

    function claimWindow(
        uint256 windowIndex,
        address account,
        uint256 amount,
        string memory metaData,
        bytes32[] memory merkleProof
    ) public nonReentrant() {
        require(!claimed[windowIndex][account], "Already claimed");
        require(verifyClaim(windowIndex, account, amount, metaData, merkleProof), "Incorrect merkle proof");

        claimed[windowIndex][account] = true;
        _disburse(account, amount, windowIndex);
    }

    function verifyClaim(
        uint256 windowIndex,
        address account,
        uint256 amount,
        string memory metaData,
        bytes32[] memory merkleProof
    ) public view returns (bool valid) {
        Window memory window = merkleWindows[windowIndex];
        bytes32 leaf =
            keccak256(
                abi.encodePacked(windowIndex, account, amount, metaData, window.rewardToken, window.start, window.end)
            );
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
