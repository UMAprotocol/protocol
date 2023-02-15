// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "./BaseEscalationManager.t.sol";
import "../../../../contracts/optimistic-oracle-v3/implementation/escalation-manager/FullPolicyEscalationManager.sol";

contract FullPolicyEscalationManagerCommon is BaseEscalationManagerTest {
    function setUp() public override {
        _commonSetup();

        // Fund Account1 for making assertion through wrapper.
        vm.startPrank(TestAddress.account1);
        defaultCurrency.allocateTo(TestAddress.account1, defaultBond);
        defaultCurrency.approve(address(assertingCaller), defaultBond);
        vm.stopPrank();

        escalationManager = address(new FullPolicyEscalationManager(address(optimisticOracleV3)));
    }
}
