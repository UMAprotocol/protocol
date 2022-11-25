// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
import "../Common.sol";
import "../../../../contracts/optimistic-assertor/implementation/examples/DataAsserter.sol";

contract DataAsserterTest is Common {
    DataAsserter public dataAsserter;
    bytes32 dataId = bytes32("dataId");
    bytes32 correctData = bytes32("correctData");
    bytes32 incorrectData = bytes32("incorrectData");

    function setUp() public {
        _commonSetup();
        dataAsserter = new DataAsserter(address(defaultCurrency), address(optimisticAssertor));
    }

    function test_DataAssertionNoDispute() public {
        // Assert data.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(dataAsserter), optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        bytes32 assertionId = dataAsserter.assertDataFor(dataId, correctData, TestAddress.account1);
        vm.stopPrank(); // Return caller address to standard.

        // Assertion data should not be available before the liveness period.
        (bool dataAvailable, bytes32 data) = dataAsserter.getData(assertionId);
        assertFalse(dataAvailable);

        // Move time forward to allow for the assertion to expire.
        timer.setCurrentTime(timer.getCurrentTime() + dataAsserter.assertionLiveness());

        // Settle the assertion.
        optimisticAssertor.settleAssertion(assertionId);

        // Data should now be available.
        (dataAvailable, data) = dataAsserter.getData(assertionId);
        assertTrue(dataAvailable);
        assertEq(data, correctData);
    }

    function test_DataAssertionWithWrongDispute() public {
        // Assert data.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(dataAsserter), optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        bytes32 assertionId = dataAsserter.assertDataFor(dataId, correctData, TestAddress.account1);
        vm.stopPrank(); // Return caller address to standard.

        // Dispute assertion with Account2 and DVM votes that the original assertion was true.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId);
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        assertTrue(optimisticAssertor.settleAndGetAssertion(assertionId));

        (bool dataAvailable, bytes32 data) = dataAsserter.getData(assertionId);
        assertTrue(dataAvailable);
        assertEq(data, correctData);
    }

    function test_DataAssertionWithCorrectDispute() public {
        // Assert data.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(dataAsserter), optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        bytes32 assertionId = dataAsserter.assertDataFor(dataId, incorrectData, TestAddress.account1);
        vm.stopPrank(); // Return caller address to standard.

        // Dispute assertion with Account2 and DVM votes that the original assertion was wrong.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId);
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        assertFalse(optimisticAssertor.settleAndGetAssertion(assertionId));

        // Check that the data assertion has been deleted
        (, , address asserter, ) = dataAsserter.assertionsData(assertionId);
        assertEq(asserter, address(0));

        (bool dataAvailable, bytes32 data) = dataAsserter.getData(assertionId);
        assertFalse(dataAvailable);

        // Increase time in the evm
        vm.warp(block.timestamp + 1);

        // Same asserter should be able to re-assert the correct data.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(dataAsserter), optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        bytes32 oaAssertionId2 = dataAsserter.assertDataFor(dataId, correctData, TestAddress.account1);
        vm.stopPrank(); // Return caller address to standard.

        // Move time forward to allow for the assertion to expire.
        timer.setCurrentTime(timer.getCurrentTime() + dataAsserter.assertionLiveness());

        // Settle the assertion.
        optimisticAssertor.settleAssertion(oaAssertionId2);

        // Data should now be available.
        (dataAvailable, data) = dataAsserter.getData(oaAssertionId2);
        assertTrue(dataAvailable);
        assertEq(data, correctData);
    }

    function test_RevertIf_AssertionAlreadyExists() public {
        // Assert data.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(dataAsserter), optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        dataAsserter.assertDataFor(dataId, correctData, TestAddress.account1);
        vm.stopPrank();

        // Assert data again with a different value.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(dataAsserter), optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        vm.expectRevert("Assertion already exists");
        dataAsserter.assertDataFor(dataId, incorrectData, TestAddress.account1);
        vm.stopPrank();
    }
}
