// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseSovereignSecurityManager.sol";
import "../../interfaces/OptimisticAssertorInterface.sol";

contract SuperbondSovereignSecurityManager is BaseSovereignSecurityManager, Ownable {
    struct ArbitrationResolution {
        bool valueSet;
        bool resolution;
    }

    struct SuperBond {
        bool superBondReached;
        uint256 superBondAmount;
    }

    // Address of linked requesting contract. Before this is set via setAssertingCaller all assertions will be blocked.
    address assertingCaller;

    mapping(bytes32 => ArbitrationResolution) arbitrationResolutions;

    mapping(IERC20 => SuperBond) public superBonds;

    event AssertingCallerUpdated(address indexed assertingCaller);
    event SuperBondAmountSet(IERC20 indexed currency, uint256 superBondAmount);
    event SuperBondReached(IERC20 indexed currency);

    // Setting superBondAmount to 0 will block all assertions for that currency.
    // This also resets the superBondReached flag.
    function setSuperBondAmount(IERC20 currency, uint256 superBondAmount) public onlyOwner {
        superBonds[currency] = SuperBond({ superBondReached: false, superBondAmount: superBondAmount });
        emit SuperBondAmountSet(currency, superBondAmount);
    }

    function setAssertingCaller(address _assertingCaller) public onlyOwner {
        require(_assertingCaller != address(0), "Invalid asserting caller");
        assertingCaller = _assertingCaller;
        emit AssertingCallerUpdated(_assertingCaller);
    }

    function setArbitrationResolution(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bool arbitrationResolution
    ) public onlyOwner {
        bytes32 requestId = keccak256(abi.encode(identifier, time, ancillaryData));
        arbitrationResolutions[requestId] = ArbitrationResolution(true, arbitrationResolution);
    }

    function processAssertionPolicies(bytes32 assertionId) public override returns (AssertionPolicies memory) {
        OptimisticAssertorInterface optimisticAssertor = OptimisticAssertorInterface(msg.sender);
        OptimisticAssertorInterface.Assertion memory assertion = optimisticAssertor.readAssertion(assertionId);
        bool allow = assertion.assertingCaller == assertingCaller && superBonds[assertion.currency].superBondAmount > 0;
        bool arbitrateViaSsm = _checkAndUpdateIfSuperBondReached(assertion.currency, assertion.bond);
        return
            AssertionPolicies({ allowAssertion: allow, useDvmAsOracle: !arbitrateViaSsm, useDisputeResolution: true });
    }

    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override returns (int256) {
        bytes32 requestId = keccak256(abi.encode(identifier, time, ancillaryData));
        require(arbitrationResolutions[requestId].valueSet, "Arbitration resolution not set");
        if (arbitrationResolutions[requestId].resolution) return 1e18;
        return 0;
    }

    function _checkAndUpdateIfSuperBondReached(IERC20 currency, uint256 bond) internal returns (bool) {
        SuperBond storage superBond = superBonds[currency];
        if (superBond.superBondReached) return true;
        if (bond >= superBond.superBondAmount) {
            superBond.superBondReached = true;
            emit SuperBondReached(currency);
            return true;
        }
        return false;
    }
}
