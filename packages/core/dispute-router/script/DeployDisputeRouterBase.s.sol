// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.22;

import { Script, console2 } from "forge-std/Script.sol";
import { UnsafeUpgrades } from "@openzeppelin/foundry-upgrades/Upgrades.sol";
import { DisputeRouter } from "../src/DisputeRouter.sol";
import { DisputeRouterCouncil, IManagedOptimisticOracleV2ForCouncil } from "../src/DisputeRouterCouncil.sol";
import { FinderInterface } from "@uma/core/data-verification-mechanism/interfaces/FinderInterface.sol";
import {
    OracleAncillaryInterface
} from "@uma/core/data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";

abstract contract DeployDisputeRouterBase is Script {
    struct RouterCommonConfig {
        address finder;
        address oracle;
        uint64 forwardDelay;
        address owner;
    }

    struct RouterDeploymentConfig {
        RouterCommonConfig router;
        address council;
    }

    struct CouncilSetupConfig {
        address mooV2;
        address initialOperator;
        string[] earlyRequestIdentifierNames;
    }

    struct CombinedDeploymentConfig {
        RouterCommonConfig router;
        CouncilSetupConfig council;
    }

    struct CouncilDeploymentConfig {
        address router;
        address owner;
        CouncilSetupConfig council;
    }

    function _deployRouter(
        RouterCommonConfig memory config,
        address council,
        address owner
    )
        internal
        returns (DisputeRouter implementation, address proxy)
    {
        implementation = new DisputeRouter(FinderInterface(config.finder));
        console2.log("Implementation deployed at:", address(implementation));

        proxy = UnsafeUpgrades.deployUUPSProxy(
            address(implementation),
            abi.encodeCall(
                DisputeRouter.initialize, (OracleAncillaryInterface(config.oracle), council, config.forwardDelay, owner)
            )
        );

        console2.log("DisputeRouter Proxy deployed at:", proxy);
    }

    function _deployAndConfigureCouncil(
        address router,
        CouncilSetupConfig memory config,
        address owner
    )
        internal
        returns (DisputeRouterCouncil council)
    {
        council =
            new DisputeRouterCouncil(DisputeRouter(router), IManagedOptimisticOracleV2ForCouncil(config.mooV2), owner);
        console2.log("DisputeRouterCouncil deployed at:", address(council));

        for (uint256 i = 0; i < config.earlyRequestIdentifierNames.length; i++) {
            council.setEarlyRequestIdentifier(_stringToBytes32(config.earlyRequestIdentifierNames[i]), true);
        }

        if (config.initialOperator != address(0)) {
            council.setOperator(config.initialOperator, true);
        }
    }

    function _getDeployerPrivateKey() internal view returns (uint256 deployerPrivateKey) {
        string memory mnemonic = vm.envString("MNEMONIC");
        return vm.deriveKey(mnemonic, 0);
    }

    function _loadRouterCommonConfig(address deployer) internal view returns (RouterCommonConfig memory config) {
        config.finder = vm.envOr("FINDER", address(0));
        config.oracle = vm.envOr("ORACLE", address(0));
        config.forwardDelay = uint64(vm.envOr("FORWARD_DELAY", uint256(3600)));
        config.owner = vm.envOr("OWNER", deployer);
    }

    function _loadRouterDeploymentConfig(address deployer)
        internal
        view
        returns (RouterDeploymentConfig memory config)
    {
        config.router = _loadRouterCommonConfig(deployer);
        config.council = vm.envOr("COUNCIL", address(0));
    }

    function _loadCouncilSetupConfig() internal view returns (CouncilSetupConfig memory config) {
        config.mooV2 = vm.envOr("MOO_V2", address(0));
        config.initialOperator = vm.envOr("INITIAL_OPERATOR", address(0));
        config.earlyRequestIdentifierNames = _getEarlyRequestIdentifierNames();
    }

    function _loadCombinedDeploymentConfig(address deployer)
        internal
        view
        returns (CombinedDeploymentConfig memory config)
    {
        config.router = _loadRouterCommonConfig(deployer);
        config.council = _loadCouncilSetupConfig();
    }

    function _loadCouncilDeploymentConfig(address deployer)
        internal
        view
        returns (CouncilDeploymentConfig memory config)
    {
        config.router = vm.envOr("ROUTER", address(0));
        config.owner = vm.envOr("OWNER", deployer);
        config.council = _loadCouncilSetupConfig();
    }

    function _requireRouterCommonConfig(RouterCommonConfig memory config) internal pure {
        require(config.finder != address(0), "FINDER not set");
        require(config.oracle != address(0), "ORACLE not set");
        require(config.owner != address(0), "OWNER not set");
    }

    function _requireRouterDeploymentConfig(RouterDeploymentConfig memory config) internal pure {
        _requireRouterCommonConfig(config.router);
        require(config.council != address(0), "COUNCIL not set");
    }

    function _requireCouncilSetupConfig(CouncilSetupConfig memory config) internal pure {
        require(config.mooV2 != address(0), "MOO_V2 not set");
    }

    function _requireCombinedDeploymentConfig(CombinedDeploymentConfig memory config) internal pure {
        _requireRouterCommonConfig(config.router);
        _requireCouncilSetupConfig(config.council);
    }

    function _requireCouncilDeploymentConfig(CouncilDeploymentConfig memory config) internal pure {
        require(config.router != address(0), "ROUTER not set");
        require(config.owner != address(0), "OWNER not set");
        _requireCouncilSetupConfig(config.council);
    }

    function _logRouterDeploymentConfig(address deployer, RouterDeploymentConfig memory config) internal pure {
        console2.log("Deployer:", deployer);
        console2.log("Finder:", config.router.finder);
        console2.log("Oracle:", config.router.oracle);
        console2.log("Council:", config.council);
        console2.log("Forward Delay:", config.router.forwardDelay);
        console2.log("Owner:", config.router.owner);
    }

    function _logCombinedDeploymentConfig(address deployer, CombinedDeploymentConfig memory config) internal pure {
        console2.log("Deployer:", deployer);
        console2.log("Finder:", config.router.finder);
        console2.log("Oracle:", config.router.oracle);
        console2.log("Managed OOv2:", config.council.mooV2);
        console2.log("Forward Delay:", config.router.forwardDelay);
        console2.log("Final Owner:", config.router.owner);
        console2.log("Initial Operator:", config.council.initialOperator);
        console2.log("Early Request Identifier Count:", config.council.earlyRequestIdentifierNames.length);
    }

    function _logCouncilDeploymentConfig(address deployer, CouncilDeploymentConfig memory config) internal pure {
        console2.log("Deployer:", deployer);
        console2.log("Router:", config.router);
        console2.log("Managed OOv2:", config.council.mooV2);
        console2.log("Final Owner:", config.owner);
        console2.log("Initial Operator:", config.council.initialOperator);
        console2.log("Early Request Identifier Count:", config.council.earlyRequestIdentifierNames.length);
    }

    function _logRouterSummary(
        DisputeRouter implementation,
        address proxy,
        address council,
        uint64 forwardDelay,
        address oracle,
        address owner
    )
        internal
        view
    {
        console2.log("");
        console2.log("=== Deployment Summary ===");
        console2.log("Implementation:", address(implementation));
        console2.log("Proxy:", proxy);
        console2.log("Council:", council);
        console2.log("Forward Delay:", forwardDelay, "seconds");
        console2.log("Oracle:", oracle);
        console2.log("Owner:", owner);
        console2.log("Chain ID:", block.chainid);
        console2.log("");
        console2.log("DisputeRouter Proxy Address:", proxy);
    }

    function _logCombinedSummary(
        DisputeRouter implementation,
        address proxy,
        address council,
        uint64 forwardDelay,
        address oracle,
        address mooV2,
        address owner
    )
        internal
        view
    {
        console2.log("");
        console2.log("=== Deployment Summary ===");
        console2.log("Implementation:", address(implementation));
        console2.log("Proxy:", proxy);
        console2.log("Council Wrapper:", council);
        console2.log("Managed OOv2:", mooV2);
        console2.log("Forward Delay:", forwardDelay, "seconds");
        console2.log("Oracle:", oracle);
        console2.log("Owner:", owner);
        console2.log("Chain ID:", block.chainid);
        console2.log("");
        console2.log("DisputeRouter Proxy Address:", proxy);
        console2.log("DisputeRouterCouncil Address:", council);
    }

    function _getEarlyRequestIdentifierNames() internal view returns (string[] memory) {
        string memory defaultEarlyRequestIdentifiers = "[\"YES_OR_NO_QUERY\",\"MULTIPLE_CHOICE_QUERY\"]";
        string memory earlyRequestIdentifiersJson =
            vm.envOr("EARLY_REQUEST_IDENTIFIERS", defaultEarlyRequestIdentifiers);
        return vm.parseJsonStringArray(earlyRequestIdentifiersJson, ".");
    }

    function _stringToBytes32(string memory value) internal pure returns (bytes32 result) {
        bytes memory valueBytes = bytes(value);
        require(valueBytes.length <= 32, "identifier too long");

        assembly {
            result := mload(add(valueBytes, 32))
        }
    }
}
