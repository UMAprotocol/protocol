pragma solidity ^0.5.0;
import "./Token.sol";
import "../interfaces/TokenInterface.sol";

/**
 * @notice A factory for creating new mintable and burnable tokens.
 */
contract TokenFactory {
    /**
     * @notice Create a new token and return to the caller. The caller will hold the only minter role
     * and become the new token's minter admin, capable of adding new minters.
     */
    function createToken(string calldata tokenName, string calldata tokenSymbol, uint8 tokenDecimals)
        external
        returns (TokenInterface newToken)
    {
        Token mintableToken = new Token(tokenName, tokenSymbol, tokenDecimals);
        mintableToken.addMinter(msg.sender);
        mintableToken.setMinterAdmin(msg.sender);
        newToken = TokenInterface(address(mintableToken));
    }
}
