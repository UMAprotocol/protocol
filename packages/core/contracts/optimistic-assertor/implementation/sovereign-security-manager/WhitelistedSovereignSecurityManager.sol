pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurityManager.sol";

contract WhitelistedSovereignSecurityManager is BaseSovereignSecurityManager, Ownable {
    mapping(address => bool) whitelistedOriginatingProposers;

    function setOriginatingProposerInWhitelist(address proposer, bool value) public onlyOwner {
        whitelistedOriginatingProposers[proposer] = value;
    }

    function getAssertionPolicies(bytes32 assertionId) public view override returns (AssertionPolicies memory) {
        return
            AssertionPolicies({
                allowAssertion: whitelistedOriginatingProposers[tx.origin],
                useDvmAsOracle: true,
                useDisputeResolution: true
            });
    }
}
