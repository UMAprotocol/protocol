// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./ConfigStoreInterface.sol";
import "../../common/implementation/Testable.sol";
import "../../common/implementation/Lockable.sol";
import "../../common/implementation/FixedPoint.sol";

/**
 * @notice ConfigStore stores configuration settings for a perpetual contract and provides and interface for it
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
        uint256 rewardRate,
        uint256 proposerBond,
        uint256 timelockLiveness,
        uint256 proposalPassedTimestamp
    );
    event ChangedConfigSettings(uint256 rewardRate, uint256 proposerBond, uint256 timelockLiveness);

    /****************************************
     *                MODIFIERS             *
     ****************************************/

    // Update config settings if possible.
    modifier updateConfig() {
        _updateConfig();
        _;
    }

    /**
     * @notice Propose new configuration settings. New settings go into effect
     * after a liveness period passes.
     * @param _initialConfig Configuration settings to initialize `currentConfig` with.
     * @param _timerAddress Address of testable Timer contract.
     */
    constructor(ConfigSettings memory _initialConfig, address _timerAddress) public Testable(_timerAddress) {
        _validateConfig(_initialConfig);
        currentConfig = _initialConfig;
    }

    /**
     * @notice Returns current config or pending config if pending liveness has expired.
     * @return ConfigSettings config settings that calling financial contract should view as "live".
     */
    function getCurrentConfig()
        external
        view
        override
        nonReentrantView()
        returns (ConfigStoreInterface.ConfigSettings memory)
    {
        if (_pendingProposalPassed()) {
            return pendingConfig;
        } else {
            return currentConfig;
        }
    }

    /**
     * @notice Propose new configuration settings. New settings go into effect
     * after a liveness period passes.
     * @param newConfig Configuration settings to publish after `currentConfig.timelockLiveness` passes from now.
     * @dev Callable only by owner. Calling this while there is already a pending proposal
     * will overwrite the pending proposal.
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
            newConfig.proposerBondPct.rawValue,
            newConfig.timelockLiveness,
            pendingPassedTimestamp
        );
    }

    function publishPendingConfig() external nonReentrant() updateConfig() {}

    /****************************************
     *         INTERNAL FUNCTIONS           *
     ****************************************/

    // Check if pending proposal can overwrite the current config.
    function _updateConfig() internal {
        // If liveness has passed, publish new reward rate.
        if (_pendingProposalPassed()) {
            currentConfig = pendingConfig;

            _deletePendingConfig();

            emit ChangedConfigSettings(
                currentConfig.rewardRatePerSecond.rawValue,
                currentConfig.proposerBondPct.rawValue,
                currentConfig.timelockLiveness
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
        // Make sure timelockLiveness is not too long, otherwise contract can might not be able to fix itself
        // before a vulnerability drains its collateral.
        require(config.timelockLiveness <= 7 days && config.timelockLiveness >= 1 days, "Invalid timelockLiveness");

        // Upper limits for the reward and bond rates are estimated based on offline discussions,
        // and it is expected that these hard-coded limits can change in future deployments.
        // For a discussion thread, go [here](https://github.com/UMAprotocol/protocol/pull/2223#discussion_r530692149).

        // Proposer bond of 0.04% is based on a maximum expected funding rate error of 200%/year.
        FixedPoint.Unsigned memory maxProposerBond = FixedPoint.fromUnscaledUint(4).div(1e4);
        require(config.proposerBondPct.isLessThan(maxProposerBond), "Invalid proposerBondPct");

        // Reward rate should be less than 100% a year => 100% / 360 days / 24 hours / 60 mins / 60 secs
        // = 0.0000033
        FixedPoint.Unsigned memory maxRewardRatePerSecond = FixedPoint.fromUnscaledUint(33).div(1e7);
        require(config.rewardRatePerSecond.isLessThan(maxRewardRatePerSecond), "Invalid rewardRatePerSecond");
    }
}
