// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

abstract contract OptimismL2StandardERC20 is ERC20 {
    address public l1Token;
    address public l2Bridge;
}
