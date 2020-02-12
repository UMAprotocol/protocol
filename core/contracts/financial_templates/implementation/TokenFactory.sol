pragma solidity ^0.5.0;
import "./Token.sol";
import "../interfaces/TokenInterface.sol";

/**
 * @notice A factory for creating new tokens and adding the creator as a minter for the newly created tokens.
 */
contract TokenFactory {
    function createToken(string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals)
        public
        returns (TokenInterface newToken)
    {
        Token mintableToken = new Token(tokenName, tokenSymbol, tokenDecimals);
        mintableToken.addMinter(msg.sender);
        newToken = TokenInterface(address(mintableToken));
    }
}
