// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.22;

import { DisputeRouter } from "../src/DisputeRouter.sol";
import { DisputeRouterCouncil } from "../src/DisputeRouterCouncil.sol";
import { DeployDisputeRouterBase } from "./DeployDisputeRouterBase.s.sol";

/**
 * @title DeployDisputeRouter
 * @notice Foundry script to deploy DisputeRouter with an externally supplied council.
 * @dev The contract uses ERC-7201 namespaced storage and ERC1967Proxy for upgradability.
 *      Future upgrades can be performed via the upgradeTo() function (owner only).
 *
 *      Note: Uses UnsafeUpgrades because the OpenZeppelin upgrades-core package has an AST
 *      dereferencer bug that prevents validation of contracts inheriting from npm dependencies.
 *      Manual review of upgrade safety should be performed before production deployment.
 *
 * Environment variables:
 * - MNEMONIC: Required. The mnemonic phrase for the deployer wallet
 * - FINDER: Required. Address of the Finder contract
 * - ORACLE: Required. Address of the Oracle contract (e.g., OracleChildTunnel)
 * - COUNCIL: Required. Address of the Council
 * - FORWARD_DELAY: Optional. Delay in seconds before forwarding (defaults to 3600, set to 0 for passthrough mode)
 * - OWNER: Optional. Address of the Owner (defaults to deployer if not provided)
 *
 * @dev Usage:
 *      FOUNDRY_PROFILE=dispute-router forge script dispute-router/script/DeployDisputeRouter.s.sol:DeployDisputeRouter \
 *          --rpc-url <RPC_URL> \
 *          --broadcast \
 *          --verify
 */
contract DeployDisputeRouter is DeployDisputeRouterBase {
    function run() external {
        uint256 deployerPrivateKey = _getDeployerPrivateKey();
        address deployer = vm.addr(deployerPrivateKey);
        RouterDeploymentConfig memory config = _loadRouterDeploymentConfig(deployer);

        _requireRouterDeploymentConfig(config);
        _logRouterDeploymentConfig(deployer, config);

        vm.startBroadcast(deployerPrivateKey);

        (DisputeRouter implementation, address proxy) =
            _deployRouter(config.router, config.council, config.router.owner);

        vm.stopBroadcast();

        _logRouterSummary(
            implementation, proxy, config.council, config.router.forwardDelay, config.router.oracle, config.router.owner
        );
    }
}

/**
 * @title DeployDisputeRouterWithCouncil
 * @notice Foundry script to deploy DisputeRouter and DisputeRouterCouncil in one flow.
 *
 * Environment variables:
 * - MNEMONIC: Required. Mnemonic for the deployer wallet.
 * - FINDER: Required. Address of the Finder contract.
 * - ORACLE: Required. Address of the Oracle contract (e.g., OracleChildTunnel).
 * - MOO_V2: Required. ManagedOptimisticOracleV2 address used for managed requests.
 * - FORWARD_DELAY: Optional. Delay in seconds before forwarding (defaults to 3600, set to 0 for passthrough mode).
 * - OWNER: Optional. Final owner for both router and council wrapper, defaults to deployer.
 * - INITIAL_OPERATOR: Optional. Initial operator to whitelist during deployment.
 * - EARLY_REQUEST_IDENTIFIERS: Optional. JSON array of identifier names to allow for TOO_EARLY_RESPONSE.
 *   Defaults to ["YES_OR_NO_QUERY","MULTIPLE_CHOICE_QUERY"].
 *
 * @dev Usage:
 *      FOUNDRY_PROFILE=dispute-router forge script dispute-router/script/DeployDisputeRouter.s.sol:DeployDisputeRouterWithCouncil \
 *          --rpc-url <RPC_URL> \
 *          --broadcast \
 *          --verify
 */
contract DeployDisputeRouterWithCouncil is DeployDisputeRouterBase {
    function run() external {
        uint256 deployerPrivateKey = _getDeployerPrivateKey();
        address deployer = vm.addr(deployerPrivateKey);
        CombinedDeploymentConfig memory config = _loadCombinedDeploymentConfig(deployer);

        _requireCombinedDeploymentConfig(config);
        _logCombinedDeploymentConfig(deployer, config);

        vm.startBroadcast(deployerPrivateKey);

        (DisputeRouter implementation, address proxy) = _deployRouter(config.router, deployer, deployer);

        DisputeRouterCouncil council = _deployAndConfigureCouncil(proxy, config.council, deployer);

        DisputeRouter(proxy).setCouncil(address(council));

        if (config.router.owner != deployer) {
            DisputeRouter(proxy).transferOwnership(config.router.owner);
            council.transferOwnership(config.router.owner);
        }

        vm.stopBroadcast();

        _logCombinedSummary(
            implementation,
            proxy,
            address(council),
            config.router.forwardDelay,
            config.router.oracle,
            config.council.mooV2,
            config.router.owner
        );
    }
}
