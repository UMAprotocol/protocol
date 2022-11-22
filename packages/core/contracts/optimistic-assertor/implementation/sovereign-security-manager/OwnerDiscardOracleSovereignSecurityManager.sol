pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurityManager.sol";

contract OwnerDiscardOracleSovereignSecurityManager is BaseSovereignSecurityManager, Ownable {
    bool public discardOracle;

    function setDiscardOracle(bool value) public onlyOwner {
        discardOracle = value;
    }

    function getAssertionPolicies(bytes32 assertionId) public view override returns (AssertionPolicies memory) {
        return AssertionPolicies({ allowAssertion: true, useDvmAsOracle: true, useDisputeResolution: !discardOracle });
    }
}
