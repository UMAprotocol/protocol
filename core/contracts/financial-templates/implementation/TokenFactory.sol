pragma solidity ^0.6.0;
import "../interfaces/TokenFactoryInterface.sol";
import "./SyntheticToken.sol";
import "../../common/interfaces/ExpandedIERC20.sol";


/**
 * @title Factory for creating new mintable and burnable tokens.
 */

contract TokenFactory is TokenFactoryInterface {
    /**
     * @notice Create a new token and return it to the caller.
     * @dev The caller will become the only minter and burner and the new owner capable of assigning the roles.
     * @param tokenName used to describe the new token.
     * @param tokenSymbol short ticker abbreviation of the name. Ideally < 5 chars.
     * @param tokenDecimals used to define the precision used in the token's numerical representation.
     * @return newToken an instance of the newly created token interface.
     */
    function createToken(
        string calldata tokenName,
        string calldata tokenSymbol,
        uint8 tokenDecimals
    ) external override returns (ExpandedIERC20 newToken) {
        require(bytes(tokenName).length != 0, "Synthetic name can't be empty");
        require(bytes(tokenSymbol).length != 0, "Synthetic symbol can't be empty");
        SyntheticToken mintableToken = new SyntheticToken(tokenName, tokenSymbol, tokenDecimals);
        mintableToken.addMinter(msg.sender);
        mintableToken.addBurner(msg.sender);
        mintableToken.resetOwner(msg.sender);
        newToken = ExpandedIERC20(address(mintableToken));
    }
}
