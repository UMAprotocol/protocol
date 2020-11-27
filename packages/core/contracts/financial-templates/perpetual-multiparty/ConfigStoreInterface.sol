// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./ConfigStore.sol";

interface ConfigStoreInterface {
    function getCurrentConfig() external view returns (ConfigStore.ConfigSettings memory);
}
