// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../fixtures/optimistic-assertor/OptimisticAssertorFixture.sol";
import "../fixtures/common/TestAddress.sol";
import "../../../contracts/optimistic-assertor/implementation/sovereign-security-manager/BaseSovereignSecurityManager.sol";

contract SovereignSecurityManagerPoliciesEnforced is Test {
    OptimisticAssertor optimisticAssertor;
    SovereignSecurityManagerInterface mockedSovereignSecurityManager;
    TestnetERC20 defaultCurrency;
    uint256 defaultBond;
    uint256 defaultLiveness;
    string claimAssertion = 'q:"The sky is blue"';

    function setUp() public {
        OptimisticAssertorFixture.OptimisticAsserterContracts memory oaContracts =
            new OptimisticAssertorFixture().setUp();
        optimisticAssertor = oaContracts.optimisticAssertor;
        defaultCurrency = oaContracts.defaultCurrency;
        defaultBond = optimisticAssertor.defaultBond();
        defaultLiveness = optimisticAssertor.defaultLiveness();

        mockedSovereignSecurityManager = new BaseSovereignSecurityManager();

        // Fund Account1 for making assertion.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.defaultBond());
        defaultCurrency.approve(address(optimisticAssertor), optimisticAssertor.defaultBond());
        vm.stopPrank();
    }

    function testDefaultPolicies() public {
        vm.prank(TestAddress.account1);
        bytes32 assertionId = optimisticAssertor.assertTruth(bytes(claimAssertion));
        OptimisticAssertorInterface.Assertion memory assertion = optimisticAssertor.readAssertion(assertionId);
        assertTrue(assertion.useDisputeResolution);
        assertTrue(assertion.useDvmAsOracle);
    }

    function test_RevertIf_AssertionBlocked() public {
        // Block any assertion.
        _mockSsmPolicies(false, true, true);

        vm.prank(TestAddress.account1);
        vm.expectRevert("Assertion not allowed");
        optimisticAssertor.assertTruthFor(
            bytes(claimAssertion),
            address(0),
            address(0),
            address(mockedSovereignSecurityManager),
            defaultCurrency,
            defaultBond,
            defaultLiveness
        );
        vm.clearMockedCalls();
    }

    function _mockSsmPolicies(
        bool allowAssertion,
        bool useDvmAsOracle,
        bool useDisputeResolution
    ) internal {
        // Mock getAssertionPolicies call to block assertion. No need to pass assertionId as mockCall uses loose matching.
        vm.mockCall(
            address(mockedSovereignSecurityManager),
            abi.encodePacked(SovereignSecurityManagerInterface.getAssertionPolicies.selector),
            abi.encode(
                SovereignSecurityManagerInterface.AssertionPolicies({
                    allowAssertion: allowAssertion,
                    useDvmAsOracle: useDvmAsOracle,
                    useDisputeResolution: useDisputeResolution
                })
            )
        );
    }
}
