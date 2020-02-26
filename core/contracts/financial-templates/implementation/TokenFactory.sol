pragma solidity ^0.6.0;
import "./SyntheticToken.sol";
import "../../common/interfaces/ExpandedIERC20.sol";


/**
 * @notice A factory for creating new mintable and burnable tokens.
 */
contract TokenFactory {
    /**
     * @notice Create a new token and return to the caller. The caller will become the only minter and burner 
     * and the new owner capable of adding new roles.
     */
    function createToken(string calldata tokenName, string calldata tokenSymbol, uint8 tokenDecimals)
        external
        returns (ExpandedIERC20 newToken)
    {
        SyntheticToken mintableToken = new SyntheticToken(tokenName, tokenSymbol, tokenDecimals);
        mintableToken.addMinter(msg.sender);
        mintableToken.addBurner(msg.sender);
        mintableToken.resetOwner(msg.sender);
        newToken = ExpandedIERC20(address(mintableToken));
    }
}
