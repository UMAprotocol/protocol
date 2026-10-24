// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "../CommonOptimisticOracleV3Test.sol";
import "../../../../contracts/data-verification-mechanism/implementation/VotingV2.sol";
import "../../../../contracts/data-verification-mechanism/implementation/Registry.sol";

contract OptimisticOracleV3WhitelistLifecycleTest is CommonOptimisticOracleV3Test {
    IdentifierWhitelist private identifierWhitelist;
    VotingV2 private voting;

    function setUp() public {
        _commonSetup();
        vm.warp(timer.getCurrentTime());
        identifierWhitelist = IdentifierWhitelist(
            finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist)
        );

        TestnetERC20 votingToken = new TestnetERC20("Voting Token", "VOTE", 18);
        votingToken.allocateTo(TestAddress.account1, 100e18);

        vm.startPrank(TestAddress.owner);
        // Staking and voting are not exercised here, so emission, slashing and the previous oracle are unused.
        voting = new VotingV2(
            0,
            0,
            86400,
            2,
            100,
            1e18,
            0.5e18,
            address(votingToken),
            address(finder),
            address(0),
            address(0)
        );
        Registry registry = new Registry();
        registry.addMember(uint256(Registry.Roles.ContractCreator), TestAddress.owner);
        finder.changeImplementationAddress(OracleInterfaces.Registry, address(registry));
        finder.changeImplementationAddress(OracleInterfaces.Oracle, address(voting));
        // Use the production OOv3 implementation and block timestamp, rather than its Timer-based test subclass.
        optimisticOracleV3 = new OptimisticOracleV3(finder, defaultCurrency, defaultLiveness);
        registry.registerContract(new address[](0), address(optimisticOracleV3));
        vm.stopPrank();
    }

    function test_RemovedIdentifierRejectsNewAssertionWithProductionDvm() public {
        assertTrue(optimisticOracleV3.cachedIdentifiers(defaultIdentifier));
        vm.prank(TestAddress.owner);
        identifierWhitelist.removeSupportedIdentifier(defaultIdentifier);

        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);
        vm.expectRevert("Unsupported identifier");
        optimisticOracleV3.assertTruthWithDefaults(falseClaimAssertion, TestAddress.account1);
        vm.stopPrank();

        assertEq(defaultCurrency.balanceOf(address(optimisticOracleV3)), 0);
        assertEq(defaultCurrency.balanceOf(TestAddress.account1), defaultBond);
    }

    function test_ProductionDvmRemovalBlocksPendingDisputeUntilReadded() public {
        bytes32 assertionId = _allocateBondAndAssertTruth(TestAddress.account1, falseClaimAssertion);
        vm.prank(TestAddress.owner);
        identifierWhitelist.removeSupportedIdentifier(defaultIdentifier);

        vm.startPrank(TestAddress.account2);
        defaultCurrency.allocateTo(TestAddress.account2, defaultBond);
        defaultCurrency.approve(address(optimisticOracleV3), defaultBond);
        vm.expectRevert("Unsupported identifier");
        optimisticOracleV3.disputeAssertion(assertionId, TestAddress.account2);
        vm.stopPrank();
        assertEq(optimisticOracleV3.getAssertion(assertionId).disputer, address(0));
        assertEq(defaultCurrency.balanceOf(TestAddress.account2), defaultBond);
        (uint256 pending, ) = voting.getNumberOfPriceRequests();
        assertEq(pending, 0);

        // Positive control: registration and funding are valid, and restoring support lets the same dispute enqueue.
        vm.prank(TestAddress.owner);
        identifierWhitelist.addSupportedIdentifier(defaultIdentifier);
        vm.prank(TestAddress.account2);
        optimisticOracleV3.disputeAssertion(assertionId, TestAddress.account2);
        assertEq(optimisticOracleV3.getAssertion(assertionId).disputer, TestAddress.account2);
        (pending, ) = voting.getNumberOfPriceRequests();
        assertEq(pending, 1);
    }
}
