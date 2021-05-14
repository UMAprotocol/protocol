// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./ConfigStoreInterface.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";

/**
 * @notice ConfigStore stores configuration settings for a perpetual contract and provides an interface for it
 * to query settings such as reward rates, proposal bond sizes, etc. The configuration settings can be upgraded
 * by a privileged account and the upgraded changes are timelocked.
 */
contract ConfigStore is ConfigStoreInterface, Testable, Lockable, Ownable {
    using SafeMath for uint256;
    using FixedPoint for FixedPoint.Unsigned;

    /****************************************
     *        STORE DATA STRUCTURES         *
     ****************************************/

    // Make currentConfig private to force user to call getCurrentConfig, which returns the pendingConfig
    // if its liveness has expired.
    ConfigStoreInterface.ConfigSettings private currentConfig;

    // Beginning on `pendingPassedTimestamp`, the `pendingConfig` can be published as the current config.
    ConfigStoreInterface.ConfigSettings public pendingConfig;
    uint256 public pendingPassedTimestamp;

    /****************************************
     *                EVENTS                *
     ****************************************/

    event ProposedNewConfigSettings(
        address indexed proposer,
        uint256 rewardRatePerSecond,
        uint256 proposerBondPercentage,
        uint256 timelockLiveness,
        int256 maxFundingRate,
        int256 minFundingRate,
        uint256 proposalTimePastLimit,
        uint256 proposalPassedTimestamp
    );
    event ChangedConfigSettings(
        uint256 rewardRatePerSecond,
        uint256 proposerBondPercentage,
        uint256 timelockLiveness,
        int256 maxFundingRate,
        int256 minFundingRate,
        uint256 proposalTimePastLimit
    );

    /****************************************
     *                MODIFIERS             *
     ****************************************/

    // Update config settings if possible.
    modifier updateConfig() {
        _updateConfig();
        _;
    }

    /**
     * @notice Construct the Config Store. An initial configuration is provided and set on construction.
     * @param _initialConfig Configuration settings to initialize `currentConfig` with.
     * @param _timerAddress Address of testable Timer contract.
     */
    constructor(ConfigSettings memory _initialConfig, address _timerAddress) Testable(_timerAddress) {
        _validateConfig(_initialConfig);
        currentConfig = _initialConfig;
    }

    /**
     * @notice Returns current config or pending config if pending liveness has expired.
     * @return ConfigSettings config settings that calling financial contract should view as "live".
     */
    function updateAndGetCurrentConfig()
        external
        override
        updateConfig()
        nonReentrant()
        returns (ConfigStoreInterface.ConfigSettings memory)
    {
        return currentConfig;
    }

    /**
     * @notice Propose new configuration settings. New settings go into effect after a liveness period passes.
     * @param newConfig Configuration settings to publish after `currentConfig.timelockLiveness` passes from block.timestamp.
     * @dev Callable only by owner. Calling this while there is already a pending proposal will overwrite the pending proposal.
     */
    function proposeNewConfig(ConfigSettings memory newConfig) external onlyOwner() nonReentrant() updateConfig() {
        _validateConfig(newConfig);

        // Warning: This overwrites a pending proposal!
        pendingConfig = newConfig;

        // Use current config's liveness period to timelock this proposal.
        pendingPassedTimestamp = getCurrentTime().add(currentConfig.timelockLiveness);

        emit ProposedNewConfigSettings(
            msg.sender,
            newConfig.rewardRatePerSecond.rawValue,
            newConfig.proposerBondPercentage.rawValue,
            newConfig.timelockLiveness,
            newConfig.maxFundingRate.rawValue,
            newConfig.minFundingRate.rawValue,
            newConfig.proposalTimePastLimit,
            pendingPassedTimestamp
        );
    }

    /**
     * @notice Publish any pending configuration settings if there is a pending proposal that has passed liveness.
     */
    function publishPendingConfig() external nonReentrant() updateConfig() {}

    /****************************************
     *         INTERNAL FUNCTIONS           *
     ****************************************/

    // Check if pending proposal can overwrite the current config.
    function _updateConfig() internal {
        // If liveness has passed, publish proposed configuration settings.
        if (_pendingProposalPassed()) {
            currentConfig = pendingConfig;

            _deletePendingConfig();

            emit ChangedConfigSettings(
                currentConfig.rewardRatePerSecond.rawValue,
                currentConfig.proposerBondPercentage.rawValue,
                currentConfig.timelockLiveness,
                currentConfig.maxFundingRate.rawValue,
                currentConfig.minFundingRate.rawValue,
                currentConfig.proposalTimePastLimit
            );
        }
    }

    function _deletePendingConfig() internal {
        delete pendingConfig;
        pendingPassedTimestamp = 0;
    }

    function _pendingProposalPassed() internal view returns (bool) {
        return (pendingPassedTimestamp != 0 && pendingPassedTimestamp <= getCurrentTime());
    }

    // Use this method to constrain values with which you can set ConfigSettings.
    function _validateConfig(ConfigStoreInterface.ConfigSettings memory config) internal pure {
        // We don't set limits on proposal timestamps because there are already natural limits:
        // - Future: price requests to the OptimisticOracle must be in the past---we can't add further constraints.
        // - Past: proposal times must always be after the last update time, and  a reasonable past limit would be 30
        //   mins, meaning that no proposal timestamp can be more than 30 minutes behind the current time.

        // Make sure timelockLiveness is not too long, otherwise contract might not be able to fix itself
        // before a vulnerability drains its collateral.
        require(config.timelockLiveness <= 7 days && config.timelockLiveness >= 1 days, "Invalid timelockLiveness");

        // The reward rate should be modified as needed to incentivize honest proposers appropriately.
        // Additionally, the rate should be less than 100% a year => 100% / 360 days / 24 hours / 60 mins / 60 secs
        // = 0.0000033
        FixedPoint.Unsigned memory maxRewardRatePerSecond = FixedPoint.fromUnscaledUint(33).div(1e7);
        require(config.rewardRatePerSecond.isLessThan(maxRewardRatePerSecond), "Invalid rewardRatePerSecond");

        // We don't set a limit on the proposer bond because it is a defense against dishonest proposers. If a proposer
        // were to successfully propose a very high or low funding rate, then their PfC would be very high. The proposer
        // could theoretically keep their "evil" funding rate alive indefinitely by continuously disputing honest
        // proposers, so we would want to be able to set the proposal bond (equal to the dispute bond) higher than their
        // PfC for each proposal liveness window. The downside of not limiting this is that the config store owner
        // can set it arbitrarily high and preclude a new funding rate from ever coming in. We suggest setting the
        // proposal bond based on the configuration's funding rate range like in this discussion:
        // https://github.com/UMAprotocol/protocol/issues/2039#issuecomment-719734383

        // We also don't set a limit on the funding rate max/min because we might need to allow very high magnitude
        // funding rates in extraordinarily volatile market situations. Note, that even though we do not bound
        // the max/min, we still recommend that the deployer of this contract set the funding rate max/min values
        // to bound the PfC of a dishonest proposer. A reasonable range might be the equivalent of [+200%/year, -200%/year].
    }
}
