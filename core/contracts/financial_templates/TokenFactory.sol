pragma solidity ^0.5.0;
import "./Token.sol";
import "./TokenInterface.sol";

/**
 * @notice A burnable and mintable ERC20.
 */
contract TokenFactory {
    function createToken (string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals) public returns (TokenInterface newToken)
    {
        Token mintableToken = new Token(tokenName, tokenSymbol, tokenDecimals);
        mintableToken.addMinter(msg.sender);
        newToken = TokenInterface(address(mintableToken));
    }
}
