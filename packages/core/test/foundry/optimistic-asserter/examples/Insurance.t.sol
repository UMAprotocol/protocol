// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
import "../Common.sol";
import "../../../../contracts/optimistic-asserter/implementation/examples/Insurance.sol";

contract InsuranceTest is Common {
    Insurance public insurance;
    bytes insuredEvent = bytes("insuredEvent");
    uint256 insuranceAmount = 100;

    function setUp() public {
        _commonSetup();
        insurance = new Insurance(address(defaultCurrency), address(optimisticAsserter));
    }

    function test_InsuranceNoDispute() public {
        defaultCurrency.allocateTo(TestAddress.account1, insuranceAmount);
        vm.startPrank(TestAddress.account1);
        defaultCurrency.approve(address(insurance), insuranceAmount);
        bytes32 policyId = insurance.issueInsurance(insuranceAmount, TestAddress.account3, insuredEvent);

        // Request payout for insured event.
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAsserter.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(insurance), optimisticAsserter.getMinimumBond(address(defaultCurrency)));
        bytes32 assertionId = insurance.requestPayout(policyId);
        vm.stopPrank(); // Return caller address to standard.

        // Move time forward to allow for the assertion to expire.
        timer.setCurrentTime(timer.getCurrentTime() + insurance.assertionLiveness());

        uint256 insuredBalanceBefore = defaultCurrency.balanceOf(TestAddress.account3);

        // Settle the assertion.
        optimisticAsserter.settleAssertion(assertionId);

        // Insured balance should have increased by the payout amount.
        assertEq(defaultCurrency.balanceOf(TestAddress.account3) - insuredBalanceBefore, insuranceAmount);
    }

    function test_InsuranceWithWrongDispute() public {
        defaultCurrency.allocateTo(TestAddress.account1, insuranceAmount);
        vm.startPrank(TestAddress.account1);
        defaultCurrency.approve(address(insurance), insuranceAmount);
        bytes32 policyId = insurance.issueInsurance(insuranceAmount, TestAddress.account3, insuredEvent);

        // Request payout for insured event.
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAsserter.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(insurance), optimisticAsserter.getMinimumBond(address(defaultCurrency)));
        bytes32 assertionId = insurance.requestPayout(policyId);
        vm.stopPrank(); // Return caller address to standard.

        // Dispute assertion with Account2.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        uint256 insuredBalanceBefore = defaultCurrency.balanceOf(TestAddress.account3);
        _mockOracleResolved(address(mockOracle), oracleRequest, true);
        assertTrue(optimisticAsserter.settleAndGetAssertionResult(assertionId));

        // Insured balance should have increased by the payout amount.
        assertEq(defaultCurrency.balanceOf(TestAddress.account3) - insuredBalanceBefore, insuranceAmount);
    }

    function test_InsuranceWithCorrectDispute() public {
        defaultCurrency.allocateTo(TestAddress.account1, insuranceAmount);
        vm.startPrank(TestAddress.account1);
        defaultCurrency.approve(address(insurance), insuranceAmount);
        bytes32 policyId = insurance.issueInsurance(insuranceAmount, TestAddress.account3, insuredEvent);

        // Request payout for insured event.
        defaultCurrency.allocateTo(TestAddress.account1, optimisticAsserter.getMinimumBond(address(defaultCurrency)));
        defaultCurrency.approve(address(insurance), optimisticAsserter.getMinimumBond(address(defaultCurrency)));
        bytes32 assertionId = insurance.requestPayout(policyId);
        vm.stopPrank(); // Return caller address to standard.

        // Dispute assertion with Account2.
        OracleRequest memory oracleRequest = _disputeAndGetOracleRequest(assertionId, defaultBond);
        uint256 insuredBalanceBefore = defaultCurrency.balanceOf(TestAddress.account3);
        _mockOracleResolved(address(mockOracle), oracleRequest, false);
        assertFalse(optimisticAsserter.settleAndGetAssertionResult(assertionId));

        // Insured balance should have not increased.
        assertEq(defaultCurrency.balanceOf(TestAddress.account3), insuredBalanceBefore);
    }

    function test_RevertIf_PolicyAlreadyExists() public {
        defaultCurrency.allocateTo(TestAddress.account1, insuranceAmount);
        vm.startPrank(TestAddress.account1);
        defaultCurrency.approve(address(insurance), insuranceAmount);
        bytes32 policyId = insurance.issueInsurance(insuranceAmount, TestAddress.account2, insuredEvent);

        vm.expectRevert("Policy already exists");
        insurance.issueInsurance(insuranceAmount, TestAddress.account2, insuredEvent);
    }
}
