// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.22;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { DisputeRouter } from "../src/DisputeRouter.sol";
import { FinderInterface } from "@uma/core/data-verification-mechanism/interfaces/FinderInterface.sol";
import {
    OracleAncillaryInterface
} from "@uma/core/data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import { OracleBaseTunnel } from "../../contracts/polygon-cross-chain-oracle/OracleBaseTunnel.sol";

// Mock Finder to return mock Registry
contract MockFinder is FinderInterface {
    address public registry;

    constructor(address _registry) {
        registry = _registry;
    }

    function changeImplementationAddress(bytes32, address) external pure override {
        revert("Not implemented");
    }

    function getImplementationAddress(bytes32 interfaceName) external view override returns (address) {
        if (interfaceName == "Registry") return registry;
        revert("Unknown interface");
    }
}

// Mock Registry to control which contracts can request prices
contract MockRegistry {
    mapping(address => bool) public registeredContracts;

    function registerContract(address contractAddress) external {
        registeredContracts[contractAddress] = true;
    }

    function isContractRegistered(address contractAddress) external view returns (bool) {
        return registeredContracts[contractAddress];
    }
}

/**
 * @title TestableOracleChildTunnel
 * @notice A testable version of OracleChildTunnel that bypasses FxPortal cross-chain complexity
 * while maintaining the real contract's behavior and state management.
 * @dev This mock inherits from OracleBaseTunnel to get the same Price storage structure and
 * state management as the real OracleChildTunnel contract.
 */
contract TestableOracleChildTunnel is OracleBaseTunnel, OracleAncillaryInterface {
    uint256 public requestCount;
    bytes32 public lastIdentifier;
    uint256 public lastTime;
    bytes public lastAncillaryData;

    // Track registered contracts (mimics the Registry check)
    mapping(address => bool) public registeredContracts;

    constructor(address _finderAddress) OracleBaseTunnel(_finderAddress) { }

    function registerContract(address contractAddress) external {
        registeredContracts[contractAddress] = true;
    }

    modifier onlyRegisteredContract() {
        require(registeredContracts[msg.sender], "Caller must be registered");
        _;
    }

    /**
     * @notice Requests a price. This mimics OracleChildTunnel.requestPrice() behavior.
     * @dev Unlike OracleChildTunnel, this doesn't send cross-chain messages but keeps the same state logic.
     */
    function requestPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    )
        public
        override
        onlyRegisteredContract
    {
        bytes32 childRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[childRequestId];

        // Send the request if it has not been requested yet (matches OracleChildTunnel logic)
        if (lookup.state != RequestState.NeverRequested) return;
        lookup.state = RequestState.Requested;

        requestCount++;
        lastIdentifier = identifier;
        lastTime = time;
        lastAncillaryData = ancillaryData;

        // In real OracleChildTunnel, this would emit PriceRequestBridged and send message to root
        // For testing, we just track the request
    }

    /**
     * @notice Returns whether a price has been resolved.
     * @dev Matches OracleChildTunnel.hasPrice() implementation exactly.
     */
    function hasPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    )
        public
        view
        override
        onlyRegisteredContract
        returns (bool)
    {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        return prices[priceRequestId].state == RequestState.Resolved;
    }

    /**
     * @notice Returns the resolved price.
     * @dev Matches OracleChildTunnel.getPrice() implementation exactly.
     */
    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    )
        public
        view
        override
        onlyRegisteredContract
        returns (int256)
    {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Resolved, "Price has not been resolved");
        return lookup.price;
    }

    /**
     * @notice Helper function to simulate receiving a resolved price from mainnet.
     * @dev In the real OracleChildTunnel, this would be triggered by _processMessageFromRoot.
     * This simulates the mainnet DVM resolving the price and pushing it back to the child chain.
     */
    function resolvePrice(bytes32 identifier, uint256 time, bytes memory ancillaryData, int256 price) external {
        bytes32 priceRequestId = _encodePriceRequest(identifier, time, ancillaryData);
        Price storage lookup = prices[priceRequestId];
        require(lookup.state == RequestState.Requested, "Price not requested");

        // Matches OracleChildTunnel._processMessageFromRoot logic
        lookup.price = price;
        lookup.state = RequestState.Resolved;
        emit PushedPrice(identifier, time, ancillaryData, price, priceRequestId);
    }
}

/**
 * @title DisputeRouterTest
 */
contract DisputeRouterTest is Test {
    DisputeRouter public router;
    DisputeRouter public implementation;
    ERC1967Proxy public proxy;

    TestableOracleChildTunnel public oracle;
    TestableOracleChildTunnel public legacyOracle;
    MockFinder public mockFinder;
    MockRegistry public mockRegistry;

    address internal owner;
    address internal council;
    address internal requester;
    uint64 internal forwardDelay;

    bytes32 internal testIdentifier = keccak256("TEST_IDENTIFIER");
    uint256 internal testTime;
    bytes internal testAncillaryData = hex"1234";
    int256 internal testPrice = 1e18;

    function setUp() public {
        // Setup test addresses
        owner = makeAddr("owner");
        council = makeAddr("council");
        requester = makeAddr("requester");
        forwardDelay = 3600; // 1 hour

        // Set testTime to be in the past
        vm.warp(10_000); // Set block.timestamp to 10000
        testTime = block.timestamp - 100; // Request time must be in the past

        // Deploy mocks
        mockRegistry = new MockRegistry();
        mockFinder = new MockFinder(address(mockRegistry));

        // Deploy TestableOracleChildTunnel (mimics real OracleChildTunnel behavior)
        oracle = new TestableOracleChildTunnel(address(mockFinder));

        legacyOracle = new TestableOracleChildTunnel(address(mockFinder));
        legacyOracle.registerContract(requester);

        // Register requester contract with DisputeRouter
        mockRegistry.registerContract(requester);

        // Deploy implementation
        implementation =
            new DisputeRouter(FinderInterface(address(mockFinder)), OracleAncillaryInterface(address(legacyOracle)));

        // Prepare initialization data
        bytes memory initData = abi.encodeWithSelector(
            DisputeRouter.initialize.selector, OracleAncillaryInterface(address(oracle)), council, forwardDelay, owner
        );

        // Deploy proxy
        proxy = new ERC1967Proxy(address(implementation), initData);

        // Cast proxy to DisputeRouter
        router = DisputeRouter(address(proxy));

        // Register DisputeRouter with the oracle so it can forward requests
        oracle.registerContract(address(router));
        legacyOracle.registerContract(address(router));
    }

    function test_Initialization() public {
        assertEq(address(router.oracle()), address(oracle));
        assertEq(address(router.legacyOracle()), address(legacyOracle));
        assertEq(router.council(), council);
        assertEq(router.forwardDelay(), forwardDelay);
        assertEq(router.owner(), owner);

        // Cannot reinitialize
        vm.expectRevert();
        router.initialize(OracleAncillaryInterface(address(oracle)), council, forwardDelay, owner);
    }

    function test_OwnershipRequiresAcceptanceAndCannotBeRenounced() public {
        address nextOwner = makeAddr("nextOwner");
        vm.prank(owner);
        router.transferOwnership(nextOwner);
        assertEq(router.owner(), owner);
        assertEq(router.pendingOwner(), nextOwner);

        vm.prank(owner);
        router.setForwardDelay(7200);
        vm.prank(makeAddr("unrelatedAccount"));
        vm.expectRevert(
            abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, makeAddr("unrelatedAccount"))
        );
        router.acceptOwnership();

        vm.prank(nextOwner);
        router.acceptOwnership();
        assertEq(router.owner(), nextOwner);
        assertEq(router.pendingOwner(), address(0));
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, owner));
        router.setForwardDelay(3600);
        vm.prank(nextOwner);
        router.setForwardDelay(3600);

        vm.prank(nextOwner);
        vm.expectRevert(DisputeRouter.OwnershipRenunciationDisabled.selector);
        router.renounceOwnership();
        assertEq(router.owner(), nextOwner);
    }

    function test_AdminFunctions() public {
        // Only owner can change settings
        vm.prank(makeAddr("nonOwner"));
        vm.expectRevert();
        router.setCouncil(makeAddr("newCouncil"));

        // Owner can update council
        address newCouncil = makeAddr("newCouncil");
        vm.prank(owner);
        router.setCouncil(newCouncil);
        assertEq(router.council(), newCouncil);

        // Owner can update forward delay
        vm.prank(owner);
        router.setForwardDelay(7200);
        assertEq(router.forwardDelay(), 7200);
    }

    function test_IdempotentRequests() public {
        vm.startPrank(requester);
        router.requestPrice(testIdentifier, testTime, testAncillaryData);

        // Second request should be a no-op (matches OracleChildTunnel behavior)
        router.requestPrice(testIdentifier, testTime, testAncillaryData);
        vm.stopPrank();

        // Only one request should exist
        vm.warp(block.timestamp + forwardDelay + 1);
        router.forwardPriceRequest(testIdentifier, testTime, testAncillaryData);
        assertEq(oracle.requestCount(), 1);
    }

    // ========================================
    // Core Resolution Paths
    // ========================================

    function testFuzz_LegacyRequestResolvesAfterCutover(int256 price) public {
        vm.prank(requester);
        legacyOracle.requestPrice(testIdentifier, testTime, testAncillaryData);

        vm.prank(requester);
        assertFalse(router.hasPrice(testIdentifier, testTime, testAncillaryData));
        vm.prank(requester);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouter.PriceWasNeverRequested.selector, testIdentifier, testTime, testAncillaryData
            )
        );
        router.getPrice(testIdentifier, testTime, testAncillaryData);

        legacyOracle.resolvePrice(testIdentifier, testTime, testAncillaryData, price);

        vm.startPrank(requester);
        assertTrue(router.hasPrice(testIdentifier, testTime, testAncillaryData));
        assertEq(router.getPrice(testIdentifier, testTime, testAncillaryData), price);
        vm.stopPrank();
        assertEq(oracle.requestCount(), 0);
    }

    function test_LegacyPriceSurvivesOracleChange() public {
        vm.prank(requester);
        legacyOracle.requestPrice(testIdentifier, testTime, testAncillaryData);
        legacyOracle.resolvePrice(testIdentifier, testTime, testAncillaryData, testPrice);

        TestableOracleChildTunnel newOracle = new TestableOracleChildTunnel(address(mockFinder));
        vm.prank(owner);
        router.setOracle(address(newOracle));

        vm.startPrank(requester);
        assertTrue(router.hasPrice(testIdentifier, testTime, testAncillaryData));
        assertEq(router.getPrice(testIdentifier, testTime, testAncillaryData), testPrice);
        vm.stopPrank();
    }

    function test_KnownRequestDoesNotUseLegacyPrice() public {
        vm.prank(requester);
        legacyOracle.requestPrice(testIdentifier, testTime, testAncillaryData);
        legacyOracle.resolvePrice(testIdentifier, testTime, testAncillaryData, testPrice);

        vm.prank(requester);
        router.requestPrice(testIdentifier, testTime, testAncillaryData);
        vm.prank(requester);
        assertFalse(router.hasPrice(testIdentifier, testTime, testAncillaryData));
        vm.prank(requester);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouter.PriceNotYetResolved.selector, testIdentifier, testTime, testAncillaryData
            )
        );
        router.getPrice(testIdentifier, testTime, testAncillaryData);

        vm.prank(council);
        router.escalateNow(testIdentifier, testTime, testAncillaryData);
        vm.prank(requester);
        assertFalse(router.hasPrice(testIdentifier, testTime, testAncillaryData));

        oracle.resolvePrice(testIdentifier, testTime, testAncillaryData, testPrice + 1);
        vm.prank(requester);
        assertEq(router.getPrice(testIdentifier, testTime, testAncillaryData), testPrice + 1);
    }

    function test_UnknownRequestWithoutLegacyOracle() public {
        DisputeRouter noLegacyImplementation =
            new DisputeRouter(FinderInterface(address(mockFinder)), OracleAncillaryInterface(address(0)));
        DisputeRouter noLegacyRouter = DisputeRouter(
            address(
                new ERC1967Proxy(
                    address(noLegacyImplementation),
                    abi.encodeCall(
                        DisputeRouter.initialize,
                        (OracleAncillaryInterface(address(oracle)), council, forwardDelay, owner)
                    )
                )
            )
        );

        vm.startPrank(requester);
        assertFalse(noLegacyRouter.hasPrice(testIdentifier, testTime, testAncillaryData));
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouter.PriceWasNeverRequested.selector, testIdentifier, testTime, testAncillaryData
            )
        );
        noLegacyRouter.getPrice(testIdentifier, testTime, testAncillaryData);
        vm.stopPrank();
    }

    function test_PublicForwardAfterDelay() public {
        vm.prank(requester);
        router.requestPrice(testIdentifier, testTime, testAncillaryData);

        vm.prank(requester);
        assertFalse(router.hasPrice(testIdentifier, testTime, testAncillaryData));
        assertEq(oracle.requestCount(), 0);

        // Wait for delay and forward
        vm.warp(block.timestamp + forwardDelay + 1);
        router.forwardPriceRequest(testIdentifier, testTime, testAncillaryData);

        assertEq(oracle.requestCount(), 1);
        assertEq(oracle.lastIdentifier(), testIdentifier);

        // Oracle resolves
        oracle.resolvePrice(testIdentifier, testTime, testAncillaryData, testPrice);

        vm.prank(requester);
        assertEq(router.getPrice(testIdentifier, testTime, testAncillaryData), testPrice);
    }

    function test_CouncilEscalatesImmediately() public {
        vm.prank(requester);
        router.requestPrice(testIdentifier, testTime, testAncillaryData);

        // Council escalates immediately (bypasses delay)
        vm.prank(council);
        router.escalateNow(testIdentifier, testTime, testAncillaryData);

        assertEq(oracle.requestCount(), 1);

        oracle.resolvePrice(testIdentifier, testTime, testAncillaryData, testPrice);

        vm.prank(requester);
        assertEq(router.getPrice(testIdentifier, testTime, testAncillaryData), testPrice);
    }

    function test_CouncilResolvesDirectly() public {
        vm.prank(requester);
        router.requestPrice(testIdentifier, testTime, testAncillaryData);

        // Council resolves without forwarding to oracle
        vm.prank(council);
        router.resolvePriceRequest(testIdentifier, testTime, testAncillaryData, testPrice);

        assertEq(oracle.requestCount(), 0);

        vm.prank(requester);
        assertEq(router.getPrice(testIdentifier, testTime, testAncillaryData), testPrice);
    }

    function test_PassthroughMode() public {
        vm.prank(owner);
        router.setForwardDelay(0);

        // Request immediately forwards to oracle
        vm.prank(requester);
        router.requestPrice(testIdentifier, testTime, testAncillaryData);

        assertEq(oracle.requestCount(), 1);

        oracle.resolvePrice(testIdentifier, testTime, testAncillaryData, testPrice);

        vm.prank(requester);
        assertEq(router.getPrice(testIdentifier, testTime, testAncillaryData), testPrice);
    }

    // ========================================
    // Edge Cases
    // ========================================

    function test_CannotForwardBeforeDelay() public {
        vm.prank(requester);
        router.requestPrice(testIdentifier, testTime, testAncillaryData);

        // Try to forward immediately (should revert)
        vm.expectRevert();
        router.forwardPriceRequest(testIdentifier, testTime, testAncillaryData);
    }

    function test_CannotResolveAfterForwarding() public {
        vm.prank(requester);
        router.requestPrice(testIdentifier, testTime, testAncillaryData);

        // Forward to oracle
        vm.warp(block.timestamp + forwardDelay + 1);
        router.forwardPriceRequest(testIdentifier, testTime, testAncillaryData);

        // Council tries to resolve after forwarding (should revert)
        vm.prank(council);
        vm.expectRevert();
        router.resolvePriceRequest(testIdentifier, testTime, testAncillaryData, testPrice);
    }

    // ========================================
    // ERC-7201 Storage Location
    // ========================================

    function test_ERC7201StorageLocation() public pure {
        // Verify the storage location follows ERC-7201 formula:
        // keccak256(abi.encode(uint256(keccak256("uma.storage.DisputeRouter")) - 1)) & ~bytes32(uint256(0xff))
        bytes32 expected =
            keccak256(abi.encode(uint256(keccak256("uma.storage.DisputeRouter")) - 1)) & ~bytes32(uint256(0xff));

        bytes32 actual = 0x27fad7f759f5b0490db0c354080fe10b99002885ea52e5a6702712b9c9c6a900;

        assertEq(actual, expected, "ERC-7201 storage location mismatch");
    }
}
