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

    struct ClaimBonding {
        bool superBondReached;
        IERC20 currency;
        uint256 currentBondAmount;
    }

    // Before this Optimistic Assertor is set via setOptimisticAssertor all assertions will revert.
    OptimisticAssertorInterface public optimisticAssertor;

    // Address of linked requesting contract. Before this is set via setAssertingCaller all assertions will be blocked.
    address public assertingCaller;

    mapping(bytes32 => ArbitrationResolution) public arbitrationResolutions;

    mapping(IERC20 => uint256) public superBonds; //Superbond amounts for each currency.

    mapping(bytes32 => ClaimBonding) public claimBondings; // Track the bondings for each claim.

    event AssertingCallerSet(address indexed assertingCaller);
    event SuperBondAmountSet(IERC20 indexed currency, uint256 superBondAmount);
    event SuperBondReached(bytes32 indexed claimId, IERC20 indexed currency);

    function setOptimisticAssertor(address optimisticAssertorAddress) public onlyOwner {
        require(optimisticAssertorAddress != address(0), "Invalid address");
        optimisticAssertor = OptimisticAssertorInterface(optimisticAssertorAddress);
    }

    // Setting superBondAmount to 0 will block all assertions for that currency.
    function setSuperBondAmount(IERC20 currency, uint256 superBondAmount) public onlyOwner {
        superBonds[currency] = superBondAmount;
        emit SuperBondAmountSet(currency, superBondAmount);
    }

    // Set the address of the contract that will be allowed to use Optimistic Assertor.
    // This can only be set once. We do not set this at constructor just to allow for some flexibility in the ordering
    // of how contracts are deployed.
    function setAssertingCaller(address _assertingCaller) public onlyOwner {
        require(_assertingCaller != address(0), "Invalid asserting caller");
        require(assertingCaller == address(0), "Asserting caller already set");
        assertingCaller = _assertingCaller;
        emit AssertingCallerSet(_assertingCaller);
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
        require(msg.sender == address(optimisticAssertor), "Only Optimistic Assertor allowed");
        OptimisticAssertorInterface.Assertion memory assertion = optimisticAssertor.readAssertion(assertionId);
        bool allow = _checkAndUpdateIfAssertionAllowed(assertion);
        bool arbitrateViaSsm = _checkAndUpdateIfSuperBondReached(assertion);
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

    function _checkAndUpdateIfAssertionAllowed(OptimisticAssertorInterface.Assertion memory assertion)
        internal
        returns (bool)
    {
        if (assertion.assertingCaller != assertingCaller) return false; // Only allow assertions through linked client contract.
        if (superBonds[assertion.currency] == 0) return false; // Only allow assertions for currencies with a super bond set.

        ClaimBonding storage claimBonding = claimBondings[assertion.claimId];
        if (address(claimBonding.currency) == address(0)) {
            // If this is the first assertion for this claim, set the currency and bond amount and allow it.
            claimBonding.currency = assertion.currency;
            claimBonding.currentBondAmount = assertion.bond;
            return true;
        }
        if (claimBonding.currency != assertion.currency) return false; // Only allow assertions for the same currency as the first assertion.
        if (assertion.bond <= claimBonding.currentBondAmount) return false; // Only allow assertions with a bond greater than the current bond.

        claimBonding.currentBondAmount = assertion.bond; // Update the current bond amount for the claim.
        return true;
    }

    function _checkAndUpdateIfSuperBondReached(OptimisticAssertorInterface.Assertion memory assertion)
        internal
        returns (bool)
    {
        ClaimBonding storage claimBonding = claimBondings[assertion.claimId];
        if (claimBonding.superBondReached) return true;
        if (assertion.bond >= superBonds[assertion.currency]) {
            claimBonding.superBondReached = true;
            emit SuperBondReached(assertion.claimId, assertion.currency);
            return true;
        }
        return false;
    }
}
