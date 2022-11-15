// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;
import "../Common.sol";
import "../../../../contracts/optimistic-assertor/implementation/examples/Insurance.sol";

contract InsuranceTest is Common {
    Insurance public insurance;

    function setUp() public {
        _commonSetup();
        insurance = new Insurance(address(defaultCurrency), address(optimisticAssertor));
    }

    function test_Insurance() public {}
}
