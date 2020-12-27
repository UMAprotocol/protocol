// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;

import "../../common/implementation/ExpandedERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Snapshot.sol";

/**
 * @title Ownership of this token allows a voter to respond to price requests.
 * @dev Supports snapshotting and allows the Oracle to mint new tokens as rewards.
 */
contract VotingToken is ExpandedERC20, ERC20Snapshot {
    /**
     * @notice Constructs the VotingToken.
     */
    constructor() public ExpandedERC20("UMA Voting Token v1", "UMA", 18) {}

    /**
     * @notice Creates a new snapshot ID.
     * @return uint256 Thew new snapshot ID.
     */
    function snapshot() external returns (uint256) {
        return _snapshot();
    }

    // _beforeTokenTransfer is an ERC20 internal method that is overridden by ERC20Snapshot,
    // therefore the compiler will complain that VotingToken must override this method
    // because the two base classes (ERC20 and ERC20Snapshot) both define the same function

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20, ERC20Snapshot) {
        super._beforeTokenTransfer(from, to, amount);
    }
}
