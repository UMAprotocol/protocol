pragma solidity 0.8.16;

import "../../../../contracts/common/implementation/Timer.sol";

contract TimerFixture {
    function setUp() public returns (Timer timer) {
        return new Timer();
    }
}
