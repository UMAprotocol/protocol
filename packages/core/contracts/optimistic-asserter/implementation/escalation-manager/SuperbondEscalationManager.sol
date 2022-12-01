pragma solidity 0.8.16;

import "./BaseEscalationManager.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../../interfaces/OptimisticAsserterInterface.sol";

contract SuperbondEscalationManager is BaseEscalationManager, Ownable {
    uint256 public superbond;

    function setSuperbond(uint256 newSuperbond) public onlyOwner {
        superbond = newSuperbond;
    }

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        OptimisticAsserterInterface optimisticAsserter = OptimisticAsserterInterface(msg.sender);
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.getAssertion(assertionId);
        return
            AssertionPolicy({
                blockAssertion: false,
                arbitrateViaEscalationManager: assertion.bond > superbond,
                discardOracle: false,
                validateDisputers: false
            });
    }
}
