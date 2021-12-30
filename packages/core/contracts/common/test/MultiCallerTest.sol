pragma solidity ^0.8.0;

import "../implementation/MultiCaller.sol";

contract MultiCallerTest is MultiCaller {
    uint256 public value;

    function call(bool shouldFail) public pure {
        require(shouldFail, "shouldFail set to true");
    }

    function add(uint256 amount) public {
        value += amount;
    }
}
