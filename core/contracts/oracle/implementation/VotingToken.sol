pragma solidity ^0.6.0;

import "../../common/MultiRole.sol";
import "../../common/ExpandedIERC20.sol";

import "@openzeppelin/contracts/drafts/ERC20Snapshot.sol";


/**
 * @title Ownership of this token allows a voter to respond to price requests.
 * @dev Supports snapshotting and allows the Oracle to mint new tokens as rewards.
 */
contract VotingToken is ExpandedIERC20, ERC20Snapshot, MultiRole {
    enum Roles {
        // Can set the minter and burner.
        Owner,
        // Addresses that can mint new tokens.
        Minter,
        // Addresses that can burn tokens that address owns.
        Burner
    }

    // Standard ERC20 metadata.
    string public constant name = "UMA Voting Token v1"; // solhint-disable-line const-name-snakecase
    string public constant symbol = "UMA"; // solhint-disable-line const-name-snakecase
    uint8 public constant decimals = 18; // solhint-disable-line const-name-snakecase

    constructor() public {
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        _createSharedRole(uint(Roles.Minter), uint(Roles.Owner), new address[](0));
        _createSharedRole(uint(Roles.Burner), uint(Roles.Owner), new address[](0));
    }

    /**
     * @dev Mints `value` tokens to `recipient`, returning true on success.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
     // prettier-ignore
    function mint(address recipient, uint value) external override onlyRoleHolder(uint(Roles.Minter)) returns (bool) {
        _mint(recipient, value);
        return true;
    }

    /**
     * @dev Burns `value` tokens owned by `msg.sender`.
     */
    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function burn(uint value) external override onlyRoleHolder(uint(Roles.Burner)) {
        _burn(msg.sender, value);
    }
}
