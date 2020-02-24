pragma solidity ^0.5.0;

import "../../common/PermissionedExpandedERC20.sol";
import "@openzeppelin/contracts/drafts/ERC20Snapshot.sol";

/**
 * @title Ownership of this token allows a voter to respond to price requests.
 * @dev Supports snapshotting and allows the Oracle to mint new tokens as rewards.
 */
contract VotingToken is PermissionedExpandedERC20, ERC20Snapshot {
    // Standard ERC20 metadata.
    string public constant name = "UMA Voting Token v1"; // solhint-disable-line const-name-snakecase
    string public constant symbol = "UMA"; // solhint-disable-line const-name-snakecase
    uint8 public constant decimals = 18; // solhint-disable-line const-name-snakecase

    constructor() public PermissionedExpandedERC20() {
        removeMember(uint(Roles.Minter), address(this));
    }
}
