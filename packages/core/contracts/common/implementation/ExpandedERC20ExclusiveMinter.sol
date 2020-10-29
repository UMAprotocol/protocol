pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./MultiRole.sol";
import "../interfaces/ExpandedIERC20ExclusiveMinter.sol";


/**
 * @title Modifies the ExpandedERC20 contract by changing the minter role to an exclusive one.
 */
contract ExpandedERC20ExclusiveMinter is ExpandedIERC20ExclusiveMinter, ERC20, MultiRole {
    enum Roles {
        // Can set the minter and burner.
        Owner,
        // Addresses that can mint new tokens.
        Minter,
        // Addresses that can burn tokens that address owns.
        Burner
    }

    /**
     * @notice Constructs the ExpandedERC20ExclusiveMinter.
     * @dev Sets the initial minter to this contract.
     * @param _tokenName The name which describes the new token.
     * @param _tokenSymbol The ticker abbreviation of the name. Ideally < 5 chars.
     * @param _tokenDecimals The number of decimals to define token precision.
     */
    constructor(
        string memory _tokenName,
        string memory _tokenSymbol,
        uint8 _tokenDecimals
    ) public ERC20(_tokenName, _tokenSymbol) {
        _setupDecimals(_tokenDecimals);
        _createExclusiveRole(uint256(Roles.Owner), uint256(Roles.Owner), msg.sender);
        _createExclusiveRole(uint256(Roles.Minter), uint256(Roles.Owner), address(this));
        _createSharedRole(uint256(Roles.Burner), uint256(Roles.Owner), new address[](0));
    }

    /**
     * @dev Mints `value` tokens to `recipient`, returning true on success.
     * @param recipient address to mint to.
     * @param value amount of tokens to mint.
     * @return True if the mint succeeded, or False.
     */
    function mint(address recipient, uint256 value)
        external
        override
        onlyRoleHolder(uint256(Roles.Minter))
        returns (bool)
    {
        _mint(recipient, value);
        return true;
    }

    /**
     * @dev Burns `value` tokens owned by `msg.sender`.
     * @param value amount of tokens to burn.
     */
    function burn(uint256 value) external override onlyRoleHolder(uint256(Roles.Burner)) {
        _burn(msg.sender, value);
    }

    /**
     * @notice Returns true if the Minter roleId represents an initialized, exclusive roleId, or reverts.
     * @return True if the Minter's roleId represents an Exclusive role.
     */
    function isMinterExclusive() public override view onlyExclusive(uint256(Roles.Minter)) returns (bool) {
        return true;
    }
}
