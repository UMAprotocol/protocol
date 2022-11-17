// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../Common.sol";
import "../../../../contracts/optimistic-assertor/implementation/sovereign-security-manager/SuperbondSovereignSecurityManager.sol";

contract SuperbondOracleSovereignSecurityManagerTest is Common {
    SuperbondSovereignSecurityManager ssm;
    TestnetERC20 anotherCurrency;
    uint256 superbondAmount;
    bytes32 assertionId1 = "first assertion";
    bytes32 assertionId2 = "second assertion";

    function setUp() public {
        ssm = new SuperbondSovereignSecurityManager();
        _commonSetup();
        superbondAmount = defaultBond * 1000;
        anotherCurrency = new TestnetERC20("Another Currency", "AC", 18);
    }

    function test_SetArbitrateResolution() public {
        bytes32 identifier = "test";
        uint256 time = 123;
        bytes memory ancillaryData = "ancillary";

        vm.expectRevert("Arbitration resolution not set");
        ssm.getPrice(identifier, time, ancillaryData);

        ssm.setArbitrationResolution(identifier, time, ancillaryData, true);
        assertTrue(ssm.getPrice(identifier, time, ancillaryData) == 1e18);

        ssm.setArbitrationResolution(identifier, time, ancillaryData, false);
        assertTrue(ssm.getPrice(identifier, time, ancillaryData) == 0);
    }

    function test_RevertIf_NotOwner() public {
        vm.startPrank(TestAddress.account1);
        vm.expectRevert("Ownable: caller is not the owner");
        ssm.setSuperBondAmount(IERC20(address(0)), 0);

        vm.expectRevert("Ownable: caller is not the owner");
        ssm.setAssertingCaller(address(0));

        vm.expectRevert("Ownable: caller is not the owner");
        ssm.setArbitrationResolution(bytes32(""), 0, bytes(""), false);

        vm.expectRevert("Ownable: caller is not the owner");
        ssm.setOptimisticAssertor(mockOptimisticAssertorAddress);
        vm.stopPrank();
    }

    function test_RevertIf_InvalidOptimisticAssertor() public {
        vm.expectRevert("Invalid address");
        ssm.setOptimisticAssertor(address(0));
    }

    function test_SetOptimisticAssertor() public {
        ssm.setOptimisticAssertor(mockOptimisticAssertorAddress);
        assertTrue(address(ssm.optimisticAssertor()) == mockOptimisticAssertorAddress);
    }

    function test_SetSuperbondAmount() public {
        vm.expectEmit(true, true, true, true);
        emit SuperBondAmountSet(defaultCurrency, superbondAmount);
        ssm.setSuperBondAmount(defaultCurrency, superbondAmount);
        assertEq(ssm.superBonds(defaultCurrency), superbondAmount);
    }

    function test_RevertIf_InvalidAssertingCaller() public {
        vm.expectRevert("Invalid asserting caller");
        ssm.setAssertingCaller(address(0));
    }

    function test_SetAssertingCaller() public {
        vm.expectEmit(true, true, true, true);
        emit AssertingCallerSet(TestAddress.account1);
        ssm.setAssertingCaller(TestAddress.account1);
        assertEq(ssm.assertingCaller(), TestAddress.account1);
    }

    function test_RevertIf_RepeatSetAssertingCaller() public {
        ssm.setAssertingCaller(TestAddress.account1);

        vm.expectRevert("Asserting caller already set");
        ssm.setAssertingCaller(TestAddress.account2);
    }

    function test_RevertIf_NotFromOptimisitcAssertor() public {
        vm.expectRevert("Only Optimistic Assertor allowed");
        ssm.processAssertionPolicies(assertionId1);
    }

    function test_FirstAssertionAllowed() public {
        _initializeSsmDefaults();

        _mockReadAssertion(assertionId1, TestAddress.account1, defaultCurrency, defaultBond, trueClaimAssertion);

        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.processAssertionPolicies(assertionId1);

        assertTrue(policy.allowAssertion);
        // Also check stored bond tracking for the claim.
        (bool superBondReached, IERC20 currency, uint256 currentBondAmount) =
            ssm.claimBondings(keccak256(trueClaimAssertion));
        assertFalse(superBondReached);
        assertEq(address(currency), address(defaultCurrency));
        assertEq(currentBondAmount, defaultBond);
    }

    function test_BlockAssertingCallerNotSet() public {
        ssm.setOptimisticAssertor(mockOptimisticAssertorAddress);
        ssm.setSuperBondAmount(defaultCurrency, superbondAmount);

        _mockReadAssertion(assertionId1, TestAddress.account1, defaultCurrency, defaultBond, trueClaimAssertion);

        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.processAssertionPolicies(assertionId1);
        assertFalse(policy.allowAssertion);
    }

    function test_BlockSuperbondNotSet() public {
        ssm.setOptimisticAssertor(mockOptimisticAssertorAddress);
        ssm.setAssertingCaller(TestAddress.account1);

        _mockReadAssertion(assertionId1, TestAddress.account1, defaultCurrency, defaultBond, trueClaimAssertion);

        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.processAssertionPolicies(assertionId1);
        assertFalse(policy.allowAssertion);
    }

    function test_BlockDifferentCurrency() public {
        _initializeSsmDefaults();
        ssm.setSuperBondAmount(anotherCurrency, superbondAmount);

        _mockReadAssertion(assertionId1, TestAddress.account1, defaultCurrency, defaultBond, trueClaimAssertion);
        _mockReadAssertion(assertionId2, TestAddress.account1, anotherCurrency, defaultBond + 1, trueClaimAssertion);

        vm.startPrank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.processAssertionPolicies(assertionId1);
        assertTrue(policy.allowAssertion);

        // Second assertion for the same claim should be blocked as its bonding is in a different currency.
        policy = ssm.processAssertionPolicies(assertionId2);
        assertFalse(policy.allowAssertion);
        vm.stopPrank();
    }

    function test_BlockSameBond() public {
        _initializeSsmDefaults();

        _mockReadAssertion(assertionId1, TestAddress.account1, defaultCurrency, defaultBond, trueClaimAssertion);
        _mockReadAssertion(assertionId2, TestAddress.account1, defaultCurrency, defaultBond, trueClaimAssertion);

        vm.startPrank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.processAssertionPolicies(assertionId1);
        assertTrue(policy.allowAssertion);

        // Second assertion for the same claim should be blocked as its bonding is the same.
        policy = ssm.processAssertionPolicies(assertionId2);
        assertFalse(policy.allowAssertion);
        vm.stopPrank();
    }

    function test_CurrentBondAmount() public {
        uint256 bond2 = defaultBond + 1;

        _initializeSsmDefaults();

        _mockReadAssertion(assertionId1, TestAddress.account1, defaultCurrency, defaultBond, trueClaimAssertion);
        _mockReadAssertion(assertionId2, TestAddress.account1, defaultCurrency, bond2, trueClaimAssertion);

        vm.startPrank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.processAssertionPolicies(assertionId1);
        assertTrue(policy.allowAssertion);

        // Also second assertion should be allowed as its bonding is increased.
        policy = ssm.processAssertionPolicies(assertionId2);
        assertTrue(policy.allowAssertion);
        vm.stopPrank();

        // Check stored bond tracking for the claim.
        (bool superBondReached, IERC20 currency, uint256 currentBondAmount) =
            ssm.claimBondings(keccak256(trueClaimAssertion));
        assertFalse(superBondReached);
        assertEq(address(currency), address(defaultCurrency));
        assertEq(currentBondAmount, bond2);
    }

    function test_BelowSuperbond() public {
        uint256 bond = superbondAmount - 1;

        _initializeSsmDefaults();

        _mockReadAssertion(assertionId1, TestAddress.account1, defaultCurrency, bond, trueClaimAssertion);

        // Below superbond should still use DVM.
        vm.prank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.processAssertionPolicies(assertionId1);
        assertTrue(policy.useDvmAsOracle);
    }

    function test_SuperbondReachedOnce() public {
        _initializeSsmDefaults();

        _mockReadAssertion(assertionId1, TestAddress.account1, defaultCurrency, superbondAmount, trueClaimAssertion);

        // Should not use DVM as superbond reached.
        vm.prank(mockOptimisticAssertorAddress);
        vm.expectEmit(true, true, true, true);
        emit SuperBondReached(keccak256(trueClaimAssertion), defaultCurrency);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.processAssertionPolicies(assertionId1);
        assertFalse(policy.useDvmAsOracle);

        // Check stored bond tracking for the claim.
        (bool superBondReached, IERC20 currency, uint256 currentBondAmount) =
            ssm.claimBondings(keccak256(trueClaimAssertion));
        assertTrue(superBondReached);
        assertEq(address(currency), address(defaultCurrency));
        assertEq(currentBondAmount, superbondAmount);
    }

    function test_NextAssertionAboveSuperbond() public {
        uint256 bond2 = superbondAmount + 1;

        _initializeSsmDefaults();

        _mockReadAssertion(assertionId1, TestAddress.account1, defaultCurrency, superbondAmount, trueClaimAssertion);
        _mockReadAssertion(assertionId2, TestAddress.account1, defaultCurrency, bond2, trueClaimAssertion);

        // Should not use DVM as superbond reached.
        vm.startPrank(mockOptimisticAssertorAddress);
        SovereignSecurityManagerInterface.AssertionPolicies memory policy = ssm.processAssertionPolicies(assertionId1);
        assertFalse(policy.useDvmAsOracle);

        // Also next assertion after reaching superbond should not use DVM.
        policy = ssm.processAssertionPolicies(assertionId2);
        assertFalse(policy.useDvmAsOracle);
        vm.stopPrank();

        // Check stored bond tracking for the claim.
        (bool superBondReached, IERC20 currency, uint256 currentBondAmount) =
            ssm.claimBondings(keccak256(trueClaimAssertion));
        assertTrue(superBondReached);
        assertEq(address(currency), address(defaultCurrency));
        assertEq(currentBondAmount, bond2);
    }

    function _mockReadAssertion(
        bytes32 assertionId,
        address assertingCaller,
        IERC20 currency,
        uint256 bond,
        bytes memory claim
    ) internal {
        OptimisticAssertorInterface.Assertion memory assertion;
        assertion.assertingCaller = assertingCaller;
        assertion.currency = currency;
        assertion.bond = bond;
        assertion.claimId = keccak256(claim);
        vm.mockCall(
            mockOptimisticAssertorAddress,
            abi.encodeWithSelector(OptimisticAssertorInterface.readAssertion.selector, assertionId),
            abi.encode(assertion)
        );
    }

    function _initializeSsmDefaults() internal {
        ssm.setOptimisticAssertor(mockOptimisticAssertorAddress);
        ssm.setAssertingCaller(TestAddress.account1);
        ssm.setSuperBondAmount(defaultCurrency, superbondAmount);
    }
}
