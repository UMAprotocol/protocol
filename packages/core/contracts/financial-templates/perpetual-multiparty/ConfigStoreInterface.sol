// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;
import "../../common/implementation/FixedPoint.sol";

import "./ConfigStore.sol";

interface ConfigStoreInterface {
    // All of the configuration settings available for querying by a perpetual.
    struct ConfigSettings {
        // Liveness period (in seconds) for an update to currentConfig to become official.
        uint256 timelockLiveness;
        // Reward rate paid to successful proposers. Percentage of 1 E.g., .1 is 10%.
        FixedPoint.Unsigned rewardRatePerSecond;
        // Bond % (of given contract's PfC) that must be staked by proposers. Percentage of 1, e.g. 0.0005 is 0.05%.
        FixedPoint.Unsigned proposerBondPct;
    }

    function getCurrentConfig() external view returns (ConfigSettings memory);
}
