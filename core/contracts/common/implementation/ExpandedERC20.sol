pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./MultiRole.sol";
import "../interfaces/ExpandedIERC20.sol";


/**
 * @title An ERC20 with permissioned burning and minting. The contract deployer will initially
 * be the owner who is capable of adding new roles.
 */
contract ExpandedERC20 is ExpandedIERC20, ERC20, MultiRole {
    enum Roles {
        // Can set the minter and burner.
        Owner,
        // Addresses that can mint new tokens.
        Minter,
        // Addresses that can burn tokens that address owns.
        Burner
    }

    /**
     * @notice Constructs the ExpandedERC20.
     * @param _tokenName The name which describes the new token.
     * @param _tokenSymbol The ticker abbreviation of the name. Ideally < 5 chars.
     * @param _tokenDecimals The number of decimals to define token precision.
     */
    constructor(string memory _tokenName, string memory _tokenSymbol, uint8 _tokenDecimals)
        public
        ERC20(_tokenName, _tokenSymbol)
    {
        _setupDecimals(_tokenDecimals);
        _createExclusiveRole(uint(Roles.Owner), uint(Roles.Owner), msg.sender);
        _createSharedRole(uint(Roles.Minter), uint(Roles.Owner), new address[](0));
        _createSharedRole(uint(Roles.Burner), uint(Roles.Owner), new address[](0));
    }

    /**
     * @dev Mints `value` tokens to `recipient`, returning true on success.
     */

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function mint(address recipient, uint256 value) external override onlyRoleHolder(uint(Roles.Minter)) returns (bool) {
        _mint(recipient, value);
        return true;
    }

    /**
     * @dev Burns `value` tokens owned by `msg.sender`.
     */

    // TODO(#969) Remove once prettier-plugin-solidity can handle the "override" keyword
    // prettier-ignore
    function burn(uint256 value) external override onlyRoleHolder(uint(Roles.Burner)) {
        _burn(msg.sender, value);
    }
}
