// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.22;

import { Test } from "forge-std/Test.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Errors } from "@openzeppelin/contracts/utils/Errors.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { DisputeRouter } from "../src/DisputeRouter.sol";
import { DisputeRouterCouncil, IManagedOptimisticOracleV2ForCouncil } from "../src/DisputeRouterCouncil.sol";
import { FinderInterface } from "@uma/core/data-verification-mechanism/interfaces/FinderInterface.sol";
import {
    OracleAncillaryInterface
} from "@uma/core/data-verification-mechanism/interfaces/OracleAncillaryInterface.sol";
import { OracleBaseTunnel } from "../../contracts/polygon-cross-chain-oracle/OracleBaseTunnel.sol";

contract MockFinderCouncil is FinderInterface {
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

contract MockRegistryCouncil {
    mapping(address => bool) public registeredContracts;

    function registerContract(address contractAddress) external {
        registeredContracts[contractAddress] = true;
    }

    function isContractRegistered(address contractAddress) external view returns (bool) {
        return registeredContracts[contractAddress];
    }
}

contract TestableOracleChildTunnelCouncil is OracleBaseTunnel, OracleAncillaryInterface {
    uint256 public requestCount;
    bytes32 public lastIdentifier;
    uint256 public lastTime;
    bytes public lastAncillaryData;

    mapping(address => bool) public registeredContracts;

    constructor(address _finderAddress) OracleBaseTunnel(_finderAddress) { }

    function registerContract(address contractAddress) external {
        registeredContracts[contractAddress] = true;
    }

    modifier onlyRegisteredContract() {
        require(registeredContracts[msg.sender], "Caller must be registered");
        _;
    }

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

        if (lookup.state != RequestState.NeverRequested) return;
        lookup.state = RequestState.Requested;

        requestCount++;
        lastIdentifier = identifier;
        lastTime = time;
        lastAncillaryData = ancillaryData;
    }

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
}

contract MockManagedOptimisticOracleV2 is IManagedOptimisticOracleV2ForCouncil {
    mapping(bytes32 => Request) internal requests;

    function setRequest(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        bool settled,
        int256 resolvedPrice
    )
        external
    {
        setRequestDetails(
            requester,
            identifier,
            timestamp,
            ancillaryData,
            settled,
            resolvedPrice,
            true,
            address(3),
            timestamp,
            timestamp + 2 hours,
            0
        );
    }

    function setRequestDetails(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        bool settled,
        int256 resolvedPrice,
        bool eventBased,
        address disputer,
        uint256 proposalTime,
        uint256 expirationTime,
        uint256 customLiveness
    )
        public
    {
        bytes32 id = _getId(requester, identifier, timestamp, ancillaryData);
        Request storage request = requests[id];
        request.currency = IERC20(address(1));
        request.proposer = address(2);
        request.disputer = disputer;
        request.settled = settled;
        request.requestSettings.eventBased = eventBased;
        request.requestSettings.customLiveness = customLiveness;
        request.resolvedPrice = resolvedPrice;
        request.expirationTime = expirationTime;
        request.proposalTime = proposalTime;
    }

    function getRequest(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    )
        external
        view
        virtual
        returns (Request memory)
    {
        return requests[_getId(requester, identifier, timestamp, ancillaryData)];
    }

    function stampAncillaryData(
        bytes memory ancillaryData,
        address requester
    )
        external
        view
        virtual
        returns (bytes memory)
    {
        return bytes.concat(hex"aaaa", ancillaryData, abi.encode(requester));
    }

    function _getId(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    )
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(requester, identifier, timestamp, ancillaryData));
    }
}

contract MockOptimisticOracleV2 {
    function stampAncillaryData(bytes memory ancillaryData, address requester) external pure returns (bytes memory) {
        return bytes.concat(hex"bbbb", ancillaryData, abi.encode(requester));
    }
}

contract ReentrantManagedOptimisticOracleV2 is MockManagedOptimisticOracleV2 {
    enum ReentryAction {
        None,
        ResolveManagedAsTooEarly,
        ResolveManagedFromSettledFollowUp
    }

    DisputeRouterCouncil internal council;
    ReentryAction internal reentryAction;
    address internal reentryRequester;
    bytes32 internal reentryIdentifier;
    uint256 internal reentryDvmRequestTimestamp;
    uint256 internal reentryFollowUpRequestTime;
    bytes internal reentryAncillaryData;

    function configureResolveManagedAsTooEarly(
        DisputeRouterCouncil _council,
        address requester,
        bytes32 identifier,
        uint256 dvmRequestTimestamp,
        bytes memory ancillaryData
    )
        external
    {
        council = _council;
        reentryAction = ReentryAction.ResolveManagedAsTooEarly;
        reentryRequester = requester;
        reentryIdentifier = identifier;
        reentryDvmRequestTimestamp = dvmRequestTimestamp;
        reentryAncillaryData = ancillaryData;
    }

    function configureResolveManagedFromSettledFollowUp(
        DisputeRouterCouncil _council,
        address requester,
        bytes32 identifier,
        uint256 dvmRequestTimestamp,
        uint256 followUpRequestTime,
        bytes memory ancillaryData
    )
        external
    {
        council = _council;
        reentryAction = ReentryAction.ResolveManagedFromSettledFollowUp;
        reentryRequester = requester;
        reentryIdentifier = identifier;
        reentryDvmRequestTimestamp = dvmRequestTimestamp;
        reentryFollowUpRequestTime = followUpRequestTime;
        reentryAncillaryData = ancillaryData;
    }

    function getRequest(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    )
        external
        view
        override
        returns (Request memory)
    {
        _reenter();
        return requests[_getId(requester, identifier, timestamp, ancillaryData)];
    }

    function stampAncillaryData(
        bytes memory ancillaryData,
        address requester
    )
        external
        view
        override
        returns (bytes memory)
    {
        _reenter();
        return bytes.concat(hex"aaaa", ancillaryData, abi.encode(requester));
    }

    function _reenter() internal view {
        if (reentryAction == ReentryAction.ResolveManagedAsTooEarly) {
            _reenterCouncil(
                abi.encodeCall(
                    DisputeRouterCouncil.resolveManagedAsTooEarly,
                    (reentryRequester, reentryIdentifier, reentryDvmRequestTimestamp, reentryAncillaryData)
                )
            );
        } else if (reentryAction == ReentryAction.ResolveManagedFromSettledFollowUp) {
            _reenterCouncil(
                abi.encodeCall(
                    DisputeRouterCouncil.resolveManagedFromSettledFollowUp,
                    (
                        reentryRequester,
                        reentryIdentifier,
                        reentryDvmRequestTimestamp,
                        reentryFollowUpRequestTime,
                        reentryAncillaryData
                    )
                )
            );
        }
    }

    function _reenterCouncil(bytes memory callData) internal view {
        (bool success, bytes memory returnData) = address(council).staticcall(callData);
        if (success) revert("Expected council reentry to revert");

        assembly ("memory-safe") {
            revert(add(returnData, 0x20), mload(returnData))
        }
    }
}

contract DisputeRouterCouncilTest is Test {
    bytes32 internal constant YES_OR_NO_QUERY = bytes32("YES_OR_NO_QUERY");
    bytes32 internal constant MULTIPLE_CHOICE_QUERY = bytes32("MULTIPLE_CHOICE_QUERY");

    event EarlyRequestIdentifierUpdated(bytes32 indexed identifier, bool allowed);
    event OperatorUpdated(address indexed operator, bool allowed);
    event ManagedResolvedTooEarly(
        address indexed operator,
        address indexed requester,
        bytes32 indexed identifier,
        uint256 dvmRequestTimestamp,
        bytes ancillaryData
    );
    event ManagedResolvedFromFollowUp(
        address indexed operator,
        address indexed requester,
        bytes32 indexed identifier,
        uint256 dvmRequestTimestamp,
        uint256 followUpRequestTime,
        bytes ancillaryData,
        int256 price
    );
    event OptimisticOracleRequestEscalated(
        address indexed operator, bytes32 indexed identifier, uint256 dvmRequestTimestamp, bytes dvmAncillaryData
    );

    DisputeRouter public router;
    DisputeRouter public implementation;
    ERC1967Proxy public proxy;
    DisputeRouterCouncil public councilWrapper;

    TestableOracleChildTunnelCouncil public oracle;
    MockFinderCouncil public mockFinder;
    MockRegistryCouncil public mockRegistry;
    MockManagedOptimisticOracleV2 public mooV2;
    MockOptimisticOracleV2 public ooV2;

    address internal owner;
    address internal temporaryCouncil;
    address internal operator;
    address internal nonOperator;
    address internal routerRequester;
    address internal managedRequester;
    address internal publicCaller;
    uint64 internal forwardDelay;

    bytes32 internal rawIdentifier = keccak256("RAW_IDENTIFIER");
    uint256 internal requestTime;
    uint256 internal ooRequestTime;
    bytes internal managedAncillaryData = hex"5678";
    bytes internal ooAncillaryData = hex"1234";
    int256 internal settledPrice = 1e18;

    function setUp() public {
        owner = makeAddr("owner");
        temporaryCouncil = makeAddr("temporaryCouncil");
        operator = makeAddr("operator");
        nonOperator = makeAddr("nonOperator");
        routerRequester = makeAddr("routerRequester");
        managedRequester = makeAddr("managedRequester");
        publicCaller = makeAddr("publicCaller");
        forwardDelay = 3600;

        vm.warp(10_000);
        requestTime = block.timestamp - 100;
        ooRequestTime = requestTime + 7;

        mockRegistry = new MockRegistryCouncil();
        mockFinder = new MockFinderCouncil(address(mockRegistry));
        oracle = new TestableOracleChildTunnelCouncil(address(mockFinder));
        mooV2 = new MockManagedOptimisticOracleV2();
        ooV2 = new MockOptimisticOracleV2();

        mockRegistry.registerContract(routerRequester);
        mockRegistry.registerContract(address(mooV2));
        mockRegistry.registerContract(address(ooV2));

        implementation = new DisputeRouter(FinderInterface(address(mockFinder)));
        bytes memory initData = abi.encodeWithSelector(
            DisputeRouter.initialize.selector,
            OracleAncillaryInterface(address(oracle)),
            temporaryCouncil,
            forwardDelay,
            owner
        );
        proxy = new ERC1967Proxy(address(implementation), initData);
        router = DisputeRouter(address(proxy));

        oracle.registerContract(address(router));

        councilWrapper = new DisputeRouterCouncil(router, IManagedOptimisticOracleV2ForCouncil(address(mooV2)), owner);
        vm.prank(owner);
        router.setCouncil(address(councilWrapper));

        vm.prank(owner);
        councilWrapper.setOperator(operator, true);

        vm.startPrank(owner);
        councilWrapper.setEarlyRequestIdentifier(YES_OR_NO_QUERY, true);
        councilWrapper.setEarlyRequestIdentifier(MULTIPLE_CHOICE_QUERY, true);
        vm.stopPrank();
    }

    function test_ConstructorRevertsWithZeroRouter() public {
        vm.expectRevert(DisputeRouterCouncil.ZeroAddress.selector);
        new DisputeRouterCouncil(DisputeRouter(address(0)), IManagedOptimisticOracleV2ForCouncil(address(mooV2)), owner);
    }

    function test_ConstructorRevertsWithZeroManagedOracle() public {
        vm.expectRevert(DisputeRouterCouncil.ZeroAddress.selector);
        new DisputeRouterCouncil(router, IManagedOptimisticOracleV2ForCouncil(address(0)), owner);
    }

    function test_ConstructorRevertsWithZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new DisputeRouterCouncil(router, IManagedOptimisticOracleV2ForCouncil(address(mooV2)), address(0));
    }

    function test_SetOperatorEmitsEventAndUpdatesState() public {
        vm.expectEmit(true, false, false, true, address(councilWrapper));
        emit OperatorUpdated(nonOperator, true);

        vm.prank(owner);
        councilWrapper.setOperator(nonOperator, true);

        assertTrue(councilWrapper.operators(nonOperator));
    }

    function test_SetOperatorRevokesExistingOperator() public {
        vm.expectEmit(true, false, false, true, address(councilWrapper));
        emit OperatorUpdated(operator, false);

        vm.prank(owner);
        councilWrapper.setOperator(operator, false);

        assertFalse(councilWrapper.operators(operator));
    }

    function test_SetOperatorRevertsForNonOwner() public {
        vm.prank(nonOperator);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, nonOperator));
        councilWrapper.setOperator(nonOperator, true);
    }

    function test_SetOperatorRevertsForZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(DisputeRouterCouncil.ZeroAddress.selector);
        councilWrapper.setOperator(address(0), true);
    }

    function test_SetEarlyRequestIdentifier() public {
        vm.expectEmit(true, false, false, true, address(councilWrapper));
        emit EarlyRequestIdentifierUpdated(rawIdentifier, true);

        vm.prank(owner);
        councilWrapper.setEarlyRequestIdentifier(rawIdentifier, true);
        assertTrue(councilWrapper.earlyRequestIdentifiers(rawIdentifier));

        vm.expectEmit(true, false, false, true, address(councilWrapper));
        emit EarlyRequestIdentifierUpdated(rawIdentifier, false);

        vm.prank(owner);
        councilWrapper.setEarlyRequestIdentifier(rawIdentifier, false);
        assertFalse(councilWrapper.earlyRequestIdentifiers(rawIdentifier));
    }

    function test_SetEarlyRequestIdentifierRevertsForNonOwner() public {
        vm.prank(nonOperator);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, nonOperator));
        councilWrapper.setEarlyRequestIdentifier(rawIdentifier, true);
    }

    function test_MulticallBatchesOwnerAdminActions() public {
        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeCall(DisputeRouterCouncil.setOperator, (nonOperator, true));
        data[1] = abi.encodeCall(DisputeRouterCouncil.setEarlyRequestIdentifier, (rawIdentifier, true));

        vm.prank(owner);
        councilWrapper.multicall(data);

        assertTrue(councilWrapper.operators(nonOperator));
        assertTrue(councilWrapper.earlyRequestIdentifiers(rawIdentifier));
    }

    function test_MulticallBatchesOperatorActions() public {
        bytes memory tooEarlyAncillaryData = hex"0102";
        bytes memory followUpAncillaryData = hex"0304";
        uint256 tooEarlyRequestTime = requestTime;
        uint256 tooEarlyMooV2RequestTime = ooRequestTime;
        uint256 followUpRequestTimestamp = requestTime + 1;
        uint256 followUpMooV2RequestTime = ooRequestTime + 1;
        uint256 followUpRequestTime = ooRequestTime + 2;

        bytes memory tooEarlyStampedAncillaryData = _requestDisputedEventBasedManagedRequest(
            YES_OR_NO_QUERY, tooEarlyRequestTime, tooEarlyMooV2RequestTime, managedRequester, tooEarlyAncillaryData
        );
        bytes memory followUpStampedAncillaryData = _requestDisputedEventBasedManagedRequest(
            rawIdentifier, followUpRequestTimestamp, followUpMooV2RequestTime, managedRequester, followUpAncillaryData
        );
        _setSettledEventBasedManagedRequest(
            rawIdentifier,
            followUpRequestTime,
            followUpRequestTimestamp + 1,
            managedRequester,
            followUpAncillaryData,
            settledPrice
        );

        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeCall(
            DisputeRouterCouncil.resolveManagedAsTooEarly,
            (managedRequester, YES_OR_NO_QUERY, tooEarlyMooV2RequestTime, tooEarlyAncillaryData)
        );
        data[1] = abi.encodeCall(
            DisputeRouterCouncil.resolveManagedFromSettledFollowUp,
            (managedRequester, rawIdentifier, followUpMooV2RequestTime, followUpRequestTime, followUpAncillaryData)
        );

        vm.prank(operator);
        councilWrapper.multicall(data);

        vm.startPrank(routerRequester);
        assertEq(
            router.getPrice(YES_OR_NO_QUERY, tooEarlyRequestTime, tooEarlyStampedAncillaryData),
            councilWrapper.TOO_EARLY_RESPONSE()
        );
        assertEq(router.getPrice(rawIdentifier, followUpRequestTimestamp, followUpStampedAncillaryData), settledPrice);
        vm.stopPrank();
    }

    function test_MulticallBubblesCustomErrors() public {
        bytes[] memory data = new bytes[](1);
        data[0] = abi.encodeCall(
            DisputeRouterCouncil.resolveManagedAsTooEarly,
            (managedRequester, YES_OR_NO_QUERY, requestTime, managedAncillaryData)
        );

        vm.prank(nonOperator);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouterCouncil.CallerNotOperator.selector, nonOperator));
        councilWrapper.multicall(data);
    }

    function test_MulticallConvertsEmptyRevertDataToFailedCall() public {
        bytes[] memory data = new bytes[](1);
        data[0] = abi.encodeWithSelector(bytes4(keccak256("missingFunction()")));

        vm.expectRevert(Errors.FailedCall.selector);
        councilWrapper.multicall(data);
    }

    function test_MulticallRevertsAtomically() public {
        bytes memory tooEarlyAncillaryData = hex"1111";
        bytes memory followUpAncillaryData = hex"2222";
        uint256 tooEarlyRequestTime = requestTime;
        uint256 tooEarlyMooV2RequestTime = ooRequestTime;
        uint256 followUpRequestTimestamp = requestTime + 1;
        uint256 followUpMooV2RequestTime = ooRequestTime + 1;
        uint256 followUpRequestTime = ooRequestTime + 2;

        bytes memory tooEarlyStampedAncillaryData = _requestDisputedEventBasedManagedRequest(
            YES_OR_NO_QUERY, tooEarlyRequestTime, tooEarlyMooV2RequestTime, managedRequester, tooEarlyAncillaryData
        );
        bytes memory followUpStampedAncillaryData = _requestDisputedEventBasedManagedRequest(
            rawIdentifier, followUpRequestTimestamp, followUpMooV2RequestTime, managedRequester, followUpAncillaryData
        );

        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeCall(
            DisputeRouterCouncil.resolveManagedAsTooEarly,
            (managedRequester, YES_OR_NO_QUERY, tooEarlyMooV2RequestTime, tooEarlyAncillaryData)
        );
        data[1] = abi.encodeCall(
            DisputeRouterCouncil.resolveManagedFromSettledFollowUp,
            (managedRequester, rawIdentifier, followUpMooV2RequestTime, followUpRequestTime, followUpAncillaryData)
        );

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouterCouncil.UnsettledFollowUpRequest.selector,
                managedRequester,
                followUpRequestTime,
                followUpAncillaryData
            )
        );
        councilWrapper.multicall(data);

        vm.startPrank(routerRequester);
        assertFalse(router.hasPrice(YES_OR_NO_QUERY, tooEarlyRequestTime, tooEarlyStampedAncillaryData));
        assertFalse(router.hasPrice(rawIdentifier, followUpRequestTimestamp, followUpStampedAncillaryData));
        vm.stopPrank();
    }

    function test_ResolveManagedAsTooEarlyForYesNoIdentifier() public {
        bytes memory stampedAncillaryData = _requestDisputedEventBasedManagedRequest(
            YES_OR_NO_QUERY, requestTime, ooRequestTime, managedRequester, managedAncillaryData
        );

        vm.expectEmit(true, true, true, true, address(councilWrapper));
        emit ManagedResolvedTooEarly(operator, managedRequester, YES_OR_NO_QUERY, requestTime, managedAncillaryData);

        vm.prank(operator);
        councilWrapper.resolveManagedAsTooEarly(managedRequester, YES_OR_NO_QUERY, ooRequestTime, managedAncillaryData);

        vm.prank(routerRequester);
        assertEq(
            router.getPrice(YES_OR_NO_QUERY, requestTime, stampedAncillaryData), councilWrapper.TOO_EARLY_RESPONSE()
        );
    }

    function test_ResolveManagedAsTooEarlyForMultipleChoiceIdentifier() public {
        bytes memory stampedAncillaryData = _requestDisputedEventBasedManagedRequest(
            MULTIPLE_CHOICE_QUERY, requestTime, ooRequestTime, managedRequester, managedAncillaryData
        );

        vm.prank(operator);
        councilWrapper.resolveManagedAsTooEarly(
            managedRequester, MULTIPLE_CHOICE_QUERY, ooRequestTime, managedAncillaryData
        );

        vm.prank(routerRequester);
        assertEq(
            router.getPrice(MULTIPLE_CHOICE_QUERY, requestTime, stampedAncillaryData),
            councilWrapper.TOO_EARLY_RESPONSE()
        );
    }

    function test_ResolveManagedAsTooEarlyRevertsForIdentifierNotAllowed() public {
        _requestManagedRequest(rawIdentifier, requestTime, managedRequester, managedAncillaryData);

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(DisputeRouterCouncil.IdentifierNotAllowedForTooEarly.selector, rawIdentifier)
        );
        councilWrapper.resolveManagedAsTooEarly(managedRequester, rawIdentifier, requestTime, managedAncillaryData);
    }

    function test_ResolveManagedAsTooEarlyRevertsWhenTargetWasNotDisputed() public {
        _requestManagedRequest(YES_OR_NO_QUERY, requestTime, managedRequester, managedAncillaryData);
        mooV2.setRequestDetails(
            managedRequester,
            YES_OR_NO_QUERY,
            ooRequestTime,
            managedAncillaryData,
            false,
            0,
            true,
            address(0),
            requestTime,
            requestTime + 2 hours,
            0
        );

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouterCouncil.ManagedRequestNotDisputed.selector,
                managedRequester,
                YES_OR_NO_QUERY,
                ooRequestTime,
                managedAncillaryData
            )
        );
        councilWrapper.resolveManagedAsTooEarly(managedRequester, YES_OR_NO_QUERY, ooRequestTime, managedAncillaryData);
    }

    function test_ResolveManagedAsTooEarlyRevertsWhenTargetIsNotEventBased() public {
        _requestManagedRequest(YES_OR_NO_QUERY, requestTime, managedRequester, managedAncillaryData);
        mooV2.setRequestDetails(
            managedRequester,
            YES_OR_NO_QUERY,
            ooRequestTime,
            managedAncillaryData,
            false,
            0,
            false,
            address(3),
            requestTime,
            requestTime + 2 hours,
            0
        );

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouterCouncil.ManagedRequestNotEventBased.selector,
                managedRequester,
                YES_OR_NO_QUERY,
                ooRequestTime,
                managedAncillaryData
            )
        );
        councilWrapper.resolveManagedAsTooEarly(managedRequester, YES_OR_NO_QUERY, ooRequestTime, managedAncillaryData);
    }

    function test_ResolveManagedYesNoFromSettledFollowUp() public {
        bytes memory stampedAncillaryData = _requestDisputedEventBasedManagedRequest(
            YES_OR_NO_QUERY, requestTime, ooRequestTime, managedRequester, managedAncillaryData
        );
        uint256 followUpRequestTime = ooRequestTime + 1;
        _setSettledEventBasedManagedRequest(
            YES_OR_NO_QUERY, followUpRequestTime, requestTime + 1, managedRequester, managedAncillaryData, settledPrice
        );

        vm.expectEmit(true, true, true, true, address(councilWrapper));
        emit ManagedResolvedFromFollowUp(
            operator,
            managedRequester,
            YES_OR_NO_QUERY,
            requestTime,
            followUpRequestTime,
            managedAncillaryData,
            settledPrice
        );

        vm.prank(operator);
        councilWrapper.resolveManagedFromSettledFollowUp(
            managedRequester, YES_OR_NO_QUERY, ooRequestTime, followUpRequestTime, managedAncillaryData
        );

        vm.prank(routerRequester);
        assertEq(router.getPrice(YES_OR_NO_QUERY, requestTime, stampedAncillaryData), settledPrice);
    }

    function test_ResolveManagedFromSettledFollowUpSupportsNonYesIdentifier() public {
        bytes memory stampedAncillaryData = _requestDisputedEventBasedManagedRequest(
            rawIdentifier, requestTime, ooRequestTime, managedRequester, managedAncillaryData
        );
        uint256 followUpRequestTime = ooRequestTime + 1;
        _setSettledEventBasedManagedRequest(
            rawIdentifier, followUpRequestTime, requestTime + 1, managedRequester, managedAncillaryData, settledPrice
        );

        vm.prank(operator);
        councilWrapper.resolveManagedFromSettledFollowUp(
            managedRequester, rawIdentifier, ooRequestTime, followUpRequestTime, managedAncillaryData
        );

        vm.prank(routerRequester);
        assertEq(router.getPrice(rawIdentifier, requestTime, stampedAncillaryData), settledPrice);
    }

    function test_ResolveManagedFromSettledFollowUpRevertsWhenUnsettled() public {
        _requestDisputedEventBasedManagedRequest(
            YES_OR_NO_QUERY, requestTime, ooRequestTime, managedRequester, managedAncillaryData
        );
        uint256 followUpRequestTime = ooRequestTime + 1;

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouterCouncil.UnsettledFollowUpRequest.selector,
                managedRequester,
                followUpRequestTime,
                managedAncillaryData
            )
        );
        councilWrapper.resolveManagedFromSettledFollowUp(
            managedRequester, YES_OR_NO_QUERY, ooRequestTime, followUpRequestTime, managedAncillaryData
        );
    }

    function test_ResolveManagedFromSettledFollowUpRevertsWhenTargetWasNotDisputed() public {
        _requestManagedRequest(YES_OR_NO_QUERY, requestTime, managedRequester, managedAncillaryData);
        mooV2.setRequestDetails(
            managedRequester,
            YES_OR_NO_QUERY,
            ooRequestTime,
            managedAncillaryData,
            false,
            0,
            true,
            address(0),
            requestTime,
            requestTime + 2 hours,
            0
        );

        uint256 followUpRequestTime = ooRequestTime + 1;
        _setSettledEventBasedManagedRequest(
            YES_OR_NO_QUERY, followUpRequestTime, requestTime + 1, managedRequester, managedAncillaryData, settledPrice
        );

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouterCouncil.ManagedRequestNotDisputed.selector,
                managedRequester,
                YES_OR_NO_QUERY,
                ooRequestTime,
                managedAncillaryData
            )
        );
        councilWrapper.resolveManagedFromSettledFollowUp(
            managedRequester, YES_OR_NO_QUERY, ooRequestTime, followUpRequestTime, managedAncillaryData
        );
    }

    function test_ResolveManagedFromSettledFollowUpRevertsWhenTargetIsNotEventBased() public {
        _requestManagedRequest(YES_OR_NO_QUERY, requestTime, managedRequester, managedAncillaryData);
        mooV2.setRequestDetails(
            managedRequester,
            YES_OR_NO_QUERY,
            ooRequestTime,
            managedAncillaryData,
            false,
            0,
            false,
            address(3),
            requestTime,
            requestTime + 2 hours,
            0
        );

        uint256 followUpRequestTime = ooRequestTime + 1;
        _setSettledEventBasedManagedRequest(
            YES_OR_NO_QUERY, followUpRequestTime, requestTime + 1, managedRequester, managedAncillaryData, settledPrice
        );

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouterCouncil.ManagedRequestNotEventBased.selector,
                managedRequester,
                YES_OR_NO_QUERY,
                ooRequestTime,
                managedAncillaryData
            )
        );
        councilWrapper.resolveManagedFromSettledFollowUp(
            managedRequester, YES_OR_NO_QUERY, ooRequestTime, followUpRequestTime, managedAncillaryData
        );
    }

    function test_ResolveManagedFromSettledFollowUpRevertsWhenFollowUpIsNotEventBased() public {
        _requestDisputedEventBasedManagedRequest(
            YES_OR_NO_QUERY, requestTime, ooRequestTime, managedRequester, managedAncillaryData
        );
        uint256 followUpRequestTime = ooRequestTime + 1;
        mooV2.setRequestDetails(
            managedRequester,
            YES_OR_NO_QUERY,
            followUpRequestTime,
            managedAncillaryData,
            true,
            settledPrice,
            false,
            address(3),
            requestTime + 1,
            requestTime + 1 + 2 hours,
            0
        );

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouterCouncil.ManagedRequestNotEventBased.selector,
                managedRequester,
                YES_OR_NO_QUERY,
                followUpRequestTime,
                managedAncillaryData
            )
        );
        councilWrapper.resolveManagedFromSettledFollowUp(
            managedRequester, YES_OR_NO_QUERY, ooRequestTime, followUpRequestTime, managedAncillaryData
        );
    }

    function test_ResolveManagedFromSettledFollowUpRevertsForTooEarlyPriceWhenIdentifierNotAllowed() public {
        _requestDisputedEventBasedManagedRequest(
            rawIdentifier, requestTime, ooRequestTime, managedRequester, managedAncillaryData
        );
        uint256 followUpRequestTime = ooRequestTime + 1;
        _setSettledEventBasedManagedRequest(
            rawIdentifier,
            followUpRequestTime,
            requestTime + 1,
            managedRequester,
            managedAncillaryData,
            councilWrapper.TOO_EARLY_RESPONSE()
        );

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(DisputeRouterCouncil.IdentifierNotAllowedForTooEarly.selector, rawIdentifier)
        );
        councilWrapper.resolveManagedFromSettledFollowUp(
            managedRequester, rawIdentifier, ooRequestTime, followUpRequestTime, managedAncillaryData
        );
    }

    function test_ResolveManagedFromSettledFollowUpRevertsForNonOperator() public {
        _requestManagedRequest(YES_OR_NO_QUERY, requestTime, managedRequester, managedAncillaryData);
        uint256 followUpRequestTime = ooRequestTime;
        mooV2.setRequest(
            managedRequester, YES_OR_NO_QUERY, followUpRequestTime, managedAncillaryData, true, settledPrice
        );

        vm.prank(nonOperator);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouterCouncil.CallerNotOperator.selector, nonOperator));
        councilWrapper.resolveManagedFromSettledFollowUp(
            managedRequester, YES_OR_NO_QUERY, requestTime, followUpRequestTime, managedAncillaryData
        );
    }

    function test_ResolveManagedAsTooEarlyRevertsForZeroRequester() public {
        vm.prank(operator);
        vm.expectRevert(DisputeRouterCouncil.ZeroAddress.selector);
        councilWrapper.resolveManagedAsTooEarly(address(0), YES_OR_NO_QUERY, requestTime, managedAncillaryData);
    }

    function test_ResolveManagedFromSettledFollowUpRevertsForZeroRequester() public {
        uint256 followUpRequestTime = ooRequestTime;
        mooV2.setRequest(address(0), YES_OR_NO_QUERY, followUpRequestTime, managedAncillaryData, true, settledPrice);

        vm.prank(operator);
        vm.expectRevert(DisputeRouterCouncil.ZeroAddress.selector);
        councilWrapper.resolveManagedFromSettledFollowUp(
            address(0), YES_OR_NO_QUERY, requestTime, followUpRequestTime, managedAncillaryData
        );
    }

    function test_ManagedActionsRequireOperator() public {
        _requestManagedYesNo(requestTime, managedRequester, managedAncillaryData);

        vm.prank(nonOperator);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouterCouncil.CallerNotOperator.selector, nonOperator));
        councilWrapper.resolveManagedAsTooEarly(managedRequester, YES_OR_NO_QUERY, requestTime, managedAncillaryData);
    }

    function test_EscalateOptimisticOracleRequestForManagedYesNo() public {
        bytes memory dvmAncillaryData = _requestManagedYesNo(requestTime, managedRequester, managedAncillaryData);

        vm.expectEmit(true, true, true, true, address(councilWrapper));
        emit OptimisticOracleRequestEscalated(operator, YES_OR_NO_QUERY, requestTime, dvmAncillaryData);

        vm.prank(operator);
        councilWrapper.escalateOptimisticOracleRequest(YES_OR_NO_QUERY, requestTime, dvmAncillaryData);

        assertEq(oracle.requestCount(), 1);
        assertEq(oracle.lastIdentifier(), YES_OR_NO_QUERY);
        assertEq(oracle.lastTime(), requestTime);
        assertEq(oracle.lastAncillaryData(), dvmAncillaryData);
    }

    function test_EscalateOptimisticOracleRequestRevertsForManagedYesNoNonOperator() public {
        bytes memory dvmAncillaryData = _requestManagedYesNo(requestTime, managedRequester, managedAncillaryData);

        vm.prank(nonOperator);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouterCouncil.CallerNotOperator.selector, nonOperator));
        councilWrapper.escalateOptimisticOracleRequest(YES_OR_NO_QUERY, requestTime, dvmAncillaryData);
    }

    function test_EscalateOptimisticOracleRequestUsesSuppliedDvmAncillaryData() public {
        bytes memory dvmAncillaryData = hex"deadbeef";

        vm.prank(routerRequester);
        router.requestPrice(YES_OR_NO_QUERY, requestTime, dvmAncillaryData);

        vm.prank(operator);
        councilWrapper.escalateOptimisticOracleRequest(YES_OR_NO_QUERY, requestTime, dvmAncillaryData);

        assertEq(oracle.requestCount(), 1);
        assertEq(oracle.lastIdentifier(), YES_OR_NO_QUERY);
        assertEq(oracle.lastTime(), requestTime);
        assertEq(oracle.lastAncillaryData(), dvmAncillaryData);
    }

    function test_EscalateOptimisticOracleRequestRevertsForNonManagedYesNoNonOperator() public {
        bytes memory dvmAncillaryData = ooV2.stampAncillaryData(ooAncillaryData, managedRequester);
        _requestDvmRequest(YES_OR_NO_QUERY, requestTime, dvmAncillaryData);

        vm.prank(nonOperator);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouterCouncil.CallerNotOperator.selector, nonOperator));
        councilWrapper.escalateOptimisticOracleRequest(YES_OR_NO_QUERY, requestTime, dvmAncillaryData);
    }

    function test_EscalateOptimisticOracleRequestForManagedOracleNonYesIdentifier() public {
        bytes memory dvmAncillaryData = mooV2.stampAncillaryData(ooAncillaryData, managedRequester);
        _requestDvmRequest(rawIdentifier, requestTime, dvmAncillaryData);

        vm.prank(operator);
        councilWrapper.escalateOptimisticOracleRequest(rawIdentifier, requestTime, dvmAncillaryData);

        assertEq(oracle.requestCount(), 1);
        assertEq(oracle.lastIdentifier(), rawIdentifier);
        assertEq(oracle.lastTime(), requestTime);
        assertEq(oracle.lastAncillaryData(), dvmAncillaryData);
    }

    function test_EscalateOptimisticOracleRequestRevertsForManagedOracleNonYesIdentifierNonOperator() public {
        bytes memory dvmAncillaryData = mooV2.stampAncillaryData(ooAncillaryData, managedRequester);
        _requestDvmRequest(rawIdentifier, requestTime, dvmAncillaryData);

        vm.prank(nonOperator);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouterCouncil.CallerNotOperator.selector, nonOperator));
        councilWrapper.escalateOptimisticOracleRequest(rawIdentifier, requestTime, dvmAncillaryData);
    }

    function test_EscalateOptimisticOracleRequestRevertsWhenRouterRequestDoesNotExist() public {
        bytes memory dvmAncillaryData = hex"deadbeef";
        bytes32 requestId = keccak256(abi.encode(rawIdentifier, requestTime, dvmAncillaryData));

        vm.expectRevert(abi.encodeWithSelector(DisputeRouter.RequestDoesNotExist.selector, requestId));
        vm.prank(operator);
        councilWrapper.escalateOptimisticOracleRequest(rawIdentifier, requestTime, dvmAncillaryData);
    }

    function test_ResolveManagedFromSettledFollowUpRejectsInvalidOrdering() public {
        _requestDisputedEventBasedManagedRequest(
            YES_OR_NO_QUERY, requestTime, ooRequestTime, managedRequester, managedAncillaryData
        );
        uint256 followUpRequestTime = ooRequestTime + 1;
        uint256 followUpDvmRequestTimestamp = requestTime - 1;
        _setSettledEventBasedManagedRequest(
            YES_OR_NO_QUERY,
            followUpRequestTime,
            followUpDvmRequestTimestamp,
            managedRequester,
            managedAncillaryData,
            settledPrice
        );

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouterCouncil.InvalidFollowUpRequestTime.selector, requestTime, followUpDvmRequestTimestamp
            )
        );
        councilWrapper.resolveManagedFromSettledFollowUp(
            managedRequester, YES_OR_NO_QUERY, ooRequestTime, followUpRequestTime, managedAncillaryData
        );
    }

    function test_ResolveManagedFromSettledFollowUpAcceptsEarlierRawFollowUpTimeWithLaterProposalTime() public {
        uint256 targetMooV2RequestTime = ooRequestTime;
        uint256 followUpRequestTime = ooRequestTime - 1;
        _requestDisputedEventBasedManagedRequest(
            YES_OR_NO_QUERY, requestTime, targetMooV2RequestTime, managedRequester, managedAncillaryData
        );
        _setSettledEventBasedManagedRequest(
            YES_OR_NO_QUERY, followUpRequestTime, requestTime, managedRequester, managedAncillaryData, settledPrice
        );

        vm.prank(operator);
        councilWrapper.resolveManagedFromSettledFollowUp(
            managedRequester, YES_OR_NO_QUERY, targetMooV2RequestTime, followUpRequestTime, managedAncillaryData
        );

        bytes memory stampedAncillaryData = mooV2.stampAncillaryData(managedAncillaryData, managedRequester);
        vm.prank(routerRequester);
        assertEq(router.getPrice(YES_OR_NO_QUERY, requestTime, stampedAncillaryData), settledPrice);
    }

    function test_ResolveManagedAsTooEarlyUsesLegacyProposalTimeFallback() public {
        uint256 legacyMooV2RequestTime = ooRequestTime;
        uint256 customLiveness = 30 minutes;
        bytes memory stampedAncillaryData =
            _requestManagedRequest(YES_OR_NO_QUERY, requestTime, managedRequester, managedAncillaryData);
        mooV2.setRequestDetails(
            managedRequester,
            YES_OR_NO_QUERY,
            legacyMooV2RequestTime,
            managedAncillaryData,
            false,
            0,
            true,
            address(3),
            0,
            requestTime + customLiveness,
            customLiveness
        );

        vm.prank(operator);
        councilWrapper.resolveManagedAsTooEarly(
            managedRequester, YES_OR_NO_QUERY, legacyMooV2RequestTime, managedAncillaryData
        );

        vm.prank(routerRequester);
        assertEq(
            router.getPrice(YES_OR_NO_QUERY, requestTime, stampedAncillaryData), councilWrapper.TOO_EARLY_RESPONSE()
        );
    }

    function test_ResolveManagedAsTooEarlyRevertsOnReentrancy() public {
        ReentrantManagedOptimisticOracleV2 reentrantMoo = new ReentrantManagedOptimisticOracleV2();
        DisputeRouterCouncil reentrantCouncil =
            _deployCouncil(IManagedOptimisticOracleV2ForCouncil(address(reentrantMoo)));

        _configureCouncilOperatorsAndIdentifiers(reentrantCouncil, address(reentrantMoo));
        bytes memory dvmAncillaryData = reentrantMoo.stampAncillaryData(managedAncillaryData, managedRequester);
        _requestDvmRequest(YES_OR_NO_QUERY, requestTime, dvmAncillaryData);
        reentrantMoo.setRequestDetails(
            managedRequester,
            YES_OR_NO_QUERY,
            ooRequestTime,
            managedAncillaryData,
            false,
            0,
            true,
            address(3),
            requestTime,
            requestTime + 2 hours,
            0
        );
        reentrantMoo.configureResolveManagedAsTooEarly(
            reentrantCouncil, managedRequester, YES_OR_NO_QUERY, ooRequestTime, managedAncillaryData
        );

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(operator);
        reentrantCouncil.resolveManagedAsTooEarly(
            managedRequester, YES_OR_NO_QUERY, ooRequestTime, managedAncillaryData
        );
    }

    function test_ResolveManagedFromSettledFollowUpRevertsOnReentrancy() public {
        ReentrantManagedOptimisticOracleV2 reentrantMoo = new ReentrantManagedOptimisticOracleV2();
        DisputeRouterCouncil reentrantCouncil =
            _deployCouncil(IManagedOptimisticOracleV2ForCouncil(address(reentrantMoo)));
        uint256 followUpRequestTime = ooRequestTime + 1;

        _configureCouncilOperatorsAndIdentifiers(reentrantCouncil, address(reentrantMoo));
        bytes memory dvmAncillaryData = reentrantMoo.stampAncillaryData(managedAncillaryData, managedRequester);
        _requestDvmRequest(YES_OR_NO_QUERY, requestTime, dvmAncillaryData);
        reentrantMoo.setRequestDetails(
            managedRequester,
            YES_OR_NO_QUERY,
            ooRequestTime,
            managedAncillaryData,
            false,
            0,
            true,
            address(3),
            requestTime,
            requestTime + 2 hours,
            0
        );
        reentrantMoo.setRequestDetails(
            managedRequester,
            YES_OR_NO_QUERY,
            followUpRequestTime,
            managedAncillaryData,
            true,
            settledPrice,
            true,
            address(3),
            requestTime + 1,
            requestTime + 1 + 2 hours,
            0
        );
        reentrantMoo.configureResolveManagedFromSettledFollowUp(
            reentrantCouncil,
            managedRequester,
            YES_OR_NO_QUERY,
            ooRequestTime,
            followUpRequestTime,
            managedAncillaryData
        );

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(operator);
        reentrantCouncil.resolveManagedFromSettledFollowUp(
            managedRequester, YES_OR_NO_QUERY, ooRequestTime, followUpRequestTime, managedAncillaryData
        );
    }

    function _requestManagedYesNo(
        uint256 dvmRequestTimestamp,
        address requester,
        bytes memory ancillaryData
    )
        internal
        returns (bytes memory stampedAncillaryData)
    {
        return _requestManagedRequest(YES_OR_NO_QUERY, dvmRequestTimestamp, requester, ancillaryData);
    }

    function _requestManagedRequest(
        bytes32 identifier,
        uint256 dvmRequestTimestamp,
        address requester,
        bytes memory ancillaryData
    )
        internal
        returns (bytes memory stampedAncillaryData)
    {
        stampedAncillaryData = mooV2.stampAncillaryData(ancillaryData, requester);

        _requestDvmRequest(identifier, dvmRequestTimestamp, stampedAncillaryData);
    }

    function _requestDisputedEventBasedManagedRequest(
        bytes32 identifier,
        uint256 dvmRequestTimestamp,
        uint256 mooV2RequestTime,
        address requester,
        bytes memory ancillaryData
    )
        internal
        returns (bytes memory stampedAncillaryData)
    {
        stampedAncillaryData = _requestManagedRequest(identifier, dvmRequestTimestamp, requester, ancillaryData);
        _setDisputedEventBasedManagedRequest(
            identifier, mooV2RequestTime, dvmRequestTimestamp, requester, ancillaryData
        );
    }

    function _setDisputedEventBasedManagedRequest(
        bytes32 identifier,
        uint256 mooV2RequestTime,
        uint256 proposalTime,
        address requester,
        bytes memory ancillaryData
    )
        internal
    {
        mooV2.setRequestDetails(
            requester,
            identifier,
            mooV2RequestTime,
            ancillaryData,
            false,
            0,
            true,
            address(3),
            proposalTime,
            proposalTime + 2 hours,
            0
        );
    }

    function _setSettledEventBasedManagedRequest(
        bytes32 identifier,
        uint256 mooV2RequestTime,
        uint256 proposalTime,
        address requester,
        bytes memory ancillaryData,
        int256 resolvedPrice
    )
        internal
    {
        mooV2.setRequestDetails(
            requester,
            identifier,
            mooV2RequestTime,
            ancillaryData,
            true,
            resolvedPrice,
            true,
            address(3),
            proposalTime,
            proposalTime + 2 hours,
            0
        );
    }

    function _requestDvmRequest(
        bytes32 identifier,
        uint256 dvmRequestTimestamp,
        bytes memory dvmAncillaryData
    )
        internal
    {
        vm.prank(routerRequester);
        router.requestPrice(identifier, dvmRequestTimestamp, dvmAncillaryData);
    }

    function _deployCouncil(IManagedOptimisticOracleV2ForCouncil managedOracle)
        internal
        returns (DisputeRouterCouncil council)
    {
        council = new DisputeRouterCouncil(router, managedOracle, owner);

        vm.prank(owner);
        router.setCouncil(address(council));
    }

    function _configureCouncilOperatorsAndIdentifiers(
        DisputeRouterCouncil council,
        address additionalOperator
    )
        internal
    {
        vm.startPrank(owner);
        council.setOperator(operator, true);
        if (additionalOperator != address(0)) council.setOperator(additionalOperator, true);
        council.setEarlyRequestIdentifier(YES_OR_NO_QUERY, true);
        council.setEarlyRequestIdentifier(MULTIPLE_CHOICE_QUERY, true);
        vm.stopPrank();
    }
}
