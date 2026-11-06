// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.22;

import { DisputeRouterCouncil } from "../src/DisputeRouterCouncil.sol";
import { DeployDisputeRouterBase } from "./DeployDisputeRouterBase.s.sol";

/**
 * @title DeployDisputeRouterCouncil
 * @notice Foundry script to deploy the non-upgradeable dispute router council wrapper.
 *
 * Environment variables:
 * - MNEMONIC: Required. Mnemonic for the deployer wallet.
 * - ROUTER: Required. DisputeRouter proxy address.
 * - MOO_V2: Required. ManagedOptimisticOracleV2 address used for managed requests.
 * - OWNER: Optional. Final owner of the council wrapper, defaults to deployer.
 * - INITIAL_OPERATOR: Optional. Initial operator to whitelist during deployment.
 * - EARLY_REQUEST_IDENTIFIERS: Optional. JSON array of identifier names to allow for TOO_EARLY_RESPONSE.
 *   Defaults to ["YES_OR_NO_QUERY","MULTIPLE_CHOICE_QUERY"].
 *
 * @dev Usage:
 *      FOUNDRY_PROFILE=dispute-router forge script dispute-router/script/DeployDisputeRouterCouncil.s.sol:DeployDisputeRouterCouncil \
 *          --rpc-url <RPC_URL> \
 *          --broadcast \
 *          --verify
 */
contract DeployDisputeRouterCouncil is DeployDisputeRouterBase {
    function run() external {
        uint256 deployerPrivateKey = _getDeployerPrivateKey();
        address deployer = vm.addr(deployerPrivateKey);
        CouncilDeploymentConfig memory config = _loadCouncilDeploymentConfig(deployer);

        _requireCouncilDeploymentConfig(config);
        _logCouncilDeploymentConfig(deployer, config);

        vm.startBroadcast(deployerPrivateKey);

        DisputeRouterCouncil council = _deployAndConfigureCouncil(config.router, config.council, deployer);

        if (config.owner != deployer) {
            council.transferOwnership(config.owner);
        }

        vm.stopBroadcast();
    }
}
