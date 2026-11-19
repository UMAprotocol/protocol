// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.22;

import { console2 } from "forge-std/Script.sol";
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
 * - OWNER: Optional. Pending owner of the council wrapper, defaults to deployer. Must accept ownership.
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

        console2.log("Council Owner:", council.owner());
        console2.log("Council Pending Owner:", council.pendingOwner());
        if (council.pendingOwner() != address(0)) {
            console2.log("Ownership handoff incomplete: OWNER must call acceptOwnership() on the council.");
        }
    }
}
