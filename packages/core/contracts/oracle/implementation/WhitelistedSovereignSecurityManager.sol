pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurityManager.sol";

contract WhitelistedSovereignSecurityManager is BaseSovereignSecurityManager, Ownable {
    mapping(address => bool) whitelistedOriginatingProposers;

    function setOriginatingProposerInWhitelist(address proposer, bool value) public onlyOwner {
        whitelistedOriginatingProposers[proposer] = value;
    }

    function shouldAllowAssertionAndRespectDvmOnArbitrate(bytes32 assertionId) public view override returns (bool) {
        require(whitelistedOriginatingProposers[tx.origin], "Proposer not whitelisted");
        return true;
    }
}
