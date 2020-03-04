pragma solidity ^0.6.0;

import "../../common/implementation/ExpandedERC20.sol";
import "@openzeppelin/contracts/drafts/ERC20Snapshot.sol";


/**
 * @title Ownership of this token allows a voter to respond to price requests.
 * @dev Supports snapshotting and allows the Oracle to mint new tokens as rewards.
 */
contract VotingToken is ExpandedERC20, ERC20Snapshot {
    // Standard ERC20 metadata.
    string public constant name = "UMA Voting Token v1"; // solhint-disable-line const-name-snakecase
    string public constant symbol = "UMA"; // solhint-disable-line const-name-snakecase
    uint8 public constant decimals = 18; // solhint-disable-line const-name-snakecase

    // _transfer, _mint and _burn are ERC20 internal methods that are overridden by ERC20Snapshot,
    // therefore the compiler will complain that VotingToken must override these methods
    // because the two base classes (ERC20 and ERC20Snapshot) both define the same functions

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function _transfer(address from, address to, uint256 value) internal override(ERC20, ERC20Snapshot) {
        super._transfer(from, to, value);
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function _mint(address account, uint256 value) internal override(ERC20, ERC20Snapshot) {
        super._mint(account, value);
    }

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function _burn(address account, uint256 value) internal override(ERC20, ERC20Snapshot) {
        super._burn(account, value);
    }
}
