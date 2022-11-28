pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurity.sol";

contract OwnerDiscardOracleSovereignSecurity is BaseSovereignSecurity, Ownable {
    bool public discardOracle;

    function setDiscardOracle(bool value) public onlyOwner {
        discardOracle = value;
    }

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        return
            AssertionPolicy({
                blockAssertion: false,
                arbitrateViaSs: false,
                discardOracle: discardOracle,
                validateDisputers: false
            });
    }
}
