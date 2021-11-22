// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface BridgePoolInterface {
    function l1Token() external view returns (IERC20);

    function changeAdmin(address newAdmin) external;

    function setLpFeeRatePerSecond(uint64 _newLpFeeRatePerSecond) external;

    function setRelaysEnabled(bool _relaysEnabled) external;
}
