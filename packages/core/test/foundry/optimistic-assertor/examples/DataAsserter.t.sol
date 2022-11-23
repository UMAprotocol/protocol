// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
import "../Common.sol";
import "../../../../contracts/optimistic-assertor/implementation/examples/DataAsserter.sol";

contract DataAsserterTest is Common {
    DataAsserter public dataAsserter;
    bytes32 dataId = bytes32("dataId");
    uint256 correctData = 1000;
    uint256 incorrectData = 2000;

    function setUp() public {
        _commonSetup();
        dataAsserter = new DataAsserter(address(defaultCurrency), address(optimisticAssertor));
    }

    function test_DataAssertionNoDispute() public {
        // Assert data.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(dataAsserter), optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        dataAsserter.assertDataFor(dataId, correctData, TestAddress.account1);
        vm.stopPrank(); // Return caller address to standard.

        // Assertion data should not be available before the liveness period.
        (bool dataAvailable, uint256 data) = dataAsserter.getData(dataId, TestAddress.account1);
        assertFalse(dataAvailable);

        // Move time forward to allow for the assertion to expire.
        timer.setCurrentTime(timer.getCurrentTime() + dataAsserter.assertionLiveness());

        // Settle the assertion.
        (, bytes32 oaAssertionId) =
            dataAsserter.assertionsData(dataAsserter.getAssertionId(dataId, TestAddress.account1));
        optimisticAssertor.settleAssertion(oaAssertionId);

        // Data should now be available.
        (dataAvailable, data) = dataAsserter.getData(dataId, TestAddress.account1);
        assertTrue(dataAvailable);
        assertEq(data, correctData);
    }

    function test_DataAssertionWithWrongDispute() public {
        // Assert data.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(dataAsserter), optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        dataAsserter.assertDataFor(dataId, correctData, TestAddress.account1);
        vm.stopPrank(); // Return caller address to standard.

        // Dispute assertion with Account2 and DVM votes that the original assertion was true.
        (, bytes32 oaAssertionId) =
            dataAsserter.assertionsData(dataAsserter.getAssertionId(dataId, TestAddress.account1));
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(oaAssertionId);
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        assertTrue(optimisticAssertor.settleAndGetAssertion(oaAssertionId));

        (bool dataAvailable, uint256 data) = dataAsserter.getData(dataId, TestAddress.account1);
        assertTrue(dataAvailable);
        assertEq(data, correctData);
    }

    function test_DataAssertionWithCorrectDispute() public {
        // Assert data.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(dataAsserter), optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        dataAsserter.assertDataFor(dataId, incorrectData, TestAddress.account1);
        vm.stopPrank(); // Return caller address to standard.

        bytes32 dataAssertionId = dataAsserter.getAssertionId(dataId, TestAddress.account1);

        // Dispute assertion with Account2 and DVM votes that the original assertion was wrong.
        (, bytes32 oaAssertionId) = dataAsserter.assertionsData(dataAssertionId);
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(oaAssertionId);
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        assertFalse(optimisticAssertor.settleAndGetAssertion(oaAssertionId));

        // Check that the data assertion has been deleted

        (, oaAssertionId) = dataAsserter.assertionsData(dataAssertionId);
        assertEq(oaAssertionId, bytes32(0));

        (bool dataAvailable, uint256 data) = dataAsserter.getData(dataId, TestAddress.account1);
        assertFalse(dataAvailable);

        // Increase time in the evm
        vm.warp(block.timestamp + 1);

        // Same asserter should be able to re-assert the correct data.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(dataAsserter), optimisticAssertor.getMinimumBond(address(defaultCurrency)));
        dataAsserter.assertDataFor(dataId, correctData, TestAddress.account1);
        vm.stopPrank(); // Return caller address to standard.

        // Move time forward to allow for the assertion to expire.
        timer.setCurrentTime(timer.getCurrentTime() + dataAsserter.assertionLiveness());

        // Settle the assertion.
        (, bytes32 oaAssertionId2) =
            dataAsserter.assertionsData(dataAsserter.getAssertionId(dataId, TestAddress.account1));
        optimisticAssertor.settleAssertion(oaAssertionId2);

        // Data should now be available.
        (dataAvailable, data) = dataAsserter.getData(dataId, TestAddress.account1);
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
        vm.expectRevert("Data already asserted");
        dataAsserter.assertDataFor(dataId, incorrectData, TestAddress.account1);
        vm.stopPrank();
    }
}
