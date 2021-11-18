// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/implementation/Testable.sol";

import "../../oracle/interfaces/FinderInterface.sol";
import "./OptimisticRewarder.sol";

// This contract is totally optional. It only aids in creating a simpler deployment experience with a guarantee of
// repeatable verification.
contract OptimisticRewarderCreator is Lockable {
    FinderInterface public finder;

    constructor(FinderInterface _finder) {
        finder = _finder;
    }

    function createOptimisticRewarder(
        string memory _name,
        string memory _symbol,
        string memory _baseUri,
        uint256 _liveness,
        IERC20 _bondToken,
        uint256 _bond,
        bytes32 _identifier,
        FinderInterface _finder
    ) public nonReentrant returns (address) {
        OptimisticRewarder optimisticRewarder =
            new OptimisticRewarder(_name, _symbol, _baseUri, _liveness, _bondToken, _bond, _identifier, finder);
        return address(optimisticRewarder);
    }
}
