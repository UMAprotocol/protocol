// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.22;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAccessManager } from "@openzeppelin/contracts/access/manager/IAccessManager.sol";
import { DisputeRouter } from "../src/DisputeRouter.sol";
import { DisputeRouterCouncil, IManagedOptimisticOracleV2ForCouncil } from "../src/DisputeRouterCouncil.sol";
import { FinderInterface } from "@uma/core/data-verification-mechanism/interfaces/FinderInterface.sol";

interface CutoverRegistry {
    function addMember(uint256 roleId, address newMember) external;
    function removeMember(uint256 roleId, address memberToRemove) external;
    function holdsRole(uint256 roleId, address memberToCheck) external view returns (bool);
    function registerContract(address[] calldata parties, address contractAddress) external;
    function isContractRegistered(address contractAddress) external view returns (bool);
}

/// @dev OptimisticOracle (V1) and OptimisticOracleV2 share these signatures.
interface CutoverOptimisticOracle {
    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes calldata ancillaryData,
        IERC20 currency,
        uint256 reward
    )
        external
        returns (uint256);
    function setBond(
        bytes32 identifier,
        uint256 timestamp,
        bytes calldata ancillaryData,
        uint256 bond
    )
        external
        returns (uint256);
    function proposePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes calldata ancillaryData,
        int256 proposedPrice
    )
        external
        returns (uint256);
    function disputePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes calldata ancillaryData
    )
        external
        returns (uint256);
    function settle(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes calldata ancillaryData
    )
        external
        returns (uint256);
}

interface CutoverManagedOracle is IManagedOptimisticOracleV2ForCouncil {
    function proposePriceFor(
        address proposer,
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes calldata ancillaryData,
        int256 proposedPrice
    )
        external
        returns (uint256);
    function disputePrice(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes calldata ancillaryData
    )
        external
        returns (uint256);
    function settle(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes calldata ancillaryData
    )
        external
        returns (uint256);
}

struct ReporterRequest {
    uint256 requestTimestamp;
    uint256 reward;
    uint256 proposalBond;
    uint64 liveness;
    bool registered;
    bool initialized;
    bool resolved;
    bool rerequestAllowed;
    bool automaticDisputeRerequestUsed;
    address requester;
    address oracleInitializer;
    bytes32 priceIdentifier;
    bytes requestRules;
    int256 outcome;
    uint256 manualRerequestsRemaining;
    uint64 minimumLiveness;
    uint64 maximumLiveness;
}

interface CutoverReporter {
    function registerRequest(
        bytes32 requestId,
        bytes32 priceIdentifier,
        bytes calldata requestRules,
        uint64 minimumLiveness,
        uint64 maximumLiveness
    )
        external;
    function initializeRequest(bytes32 requestId, uint256 reward, uint256 proposalBond, uint64 liveness) external;
    function getRequest(bytes32 requestId) external view returns (ReporterRequest memory);
}

interface CutoverChildTunnel {
    function processMessageFromRoot(uint256 stateId, address rootMessageSender, bytes calldata data) external;
}

interface CutoverStore {
    function computeFinalFee(address currency) external view returns (uint256 rawValue);
}

interface CutoverOOv3 {
    function cachedOracle() external view returns (address);
    function getMinimumBond(address currency) external view returns (uint256);
    function assertTruth(
        bytes calldata claim,
        address asserter,
        address callbackRecipient,
        address escalationManager,
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 identifier,
        bytes32 domainId
    )
        external
        returns (bytes32);
    function disputeAssertion(bytes32 assertionId, address disputer) external;
    function syncUmaParams(bytes32 identifier, address currency) external;
    function settleAssertion(bytes32 assertionId) external;
    function getAssertionResult(bytes32 assertionId) external view returns (bool);
}

/// @dev Polymarket V1 UmaCtfAdapter question state.
struct AdapterQuestion {
    uint256 requestTimestamp;
    uint256 reward;
    uint256 proposalBond;
    uint256 liveness;
    uint256 manualResolutionTimestamp;
    bool resolved;
    bool paused;
    bool reset;
    bool refund;
    address rewardToken;
    address creator;
    bytes ancillaryData;
}

interface CutoverCtfAdapter {
    function initialize(
        bytes calldata ancillaryData,
        address rewardToken,
        uint256 reward,
        uint256 proposalBond,
        uint256 liveness
    )
        external
        returns (bytes32 questionID);
    function getQuestion(bytes32 questionID) external view returns (AdapterQuestion memory);
    function ready(bytes32 questionID) external view returns (bool);
    function resolve(bytes32 questionID) external;
}

/// @dev Real Polygon Optimistic Oracles dispute into the deployed DisputeRouter after the governance cutover.
/// Cross-chain delivery is impersonated: the governance relay is executed as GovernorChildTunnel and DVM answers are
/// delivered as FxChild with the root tunnel as sender. The pending Safe role setup is replayed by impersonating the
/// Safe. DVM voting is not simulated; prices are fixtures.
contract PolygonCutoverForkTest is Test {
    uint256 internal constant POLYGON_BLOCK = 97_725_000;

    DisputeRouter internal constant ROUTER = DisputeRouter(0x90326E769C9371AFd379eAB03Bbd3c4d4ca4e783);
    DisputeRouterCouncil internal constant COUNCIL = DisputeRouterCouncil(0xf795636b28426A84aab27f60584ffF7fd32C5981);
    IAccessManager internal constant MANAGER = IAccessManager(0xfa6f0Ff6c719001Cba691Ff12CeaA9c49aCDCb66);
    address internal constant SAFE = 0x6ee4D971142afadEa1828445124D6137080B4146;
    address internal constant BACKUP = 0x2C6fD40A60d91597a17e4b7Dde9687FfAFf3F250;

    address internal constant CHILD = 0xac60353a54873c446101216829a6A98cDbbC3f3D;
    address internal constant ROOT_TUNNEL = 0x9B40E25dDd4518F36c50ce8AEf53Ee527419D55d;
    address internal constant FX_CHILD = 0x8397259c983751DAf40400790063935a11afa28a;
    address internal constant GOVERNOR = 0xb4AeaD497FCbEAA3C37919032d42C29682f46376;
    FinderInterface internal constant FINDER = FinderInterface(0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64);
    CutoverRegistry internal constant REGISTRY = CutoverRegistry(0x5f25B1647FA8EAea0E15EDD413C7afcBe613B6f4);
    address internal constant STORE = 0xE58480CA74f1A819faFd777BEDED4E2D5629943d;
    IERC20 internal constant USDC = IERC20(0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174);
    // Polygon OOv3 assertions use native USDC and ASSERT_TRUTH2; ASSERT_TRUTH is not whitelisted on Polygon.
    IERC20 internal constant NATIVE_USDC = IERC20(0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359);
    bytes32 internal constant ASSERT_TRUTH2 = "ASSERT_TRUTH2";

    CutoverOptimisticOracle internal constant OO_V1 =
        CutoverOptimisticOracle(0xBb1A8db2D4350976a11cdfA60A1d43f97710Da49);
    CutoverOptimisticOracle internal constant OO_V2 =
        CutoverOptimisticOracle(0xeE3Afe347D5C74317041E2618C49534dAf887c24);
    CutoverOOv3 internal constant OO_V3 = CutoverOOv3(0x5953f2538F613E05bAED8A5AeFa8e6622467AD3D);
    // UmaCtfAdapter on OOv2 currently creating Polymarket V1 requests.
    CutoverCtfAdapter internal constant CTF_ADAPTER = CutoverCtfAdapter(0x056E680AAe1F3BE339e375070B56FcbB326fa297);
    CutoverManagedOracle internal constant MOO_V2 = CutoverManagedOracle(0x2C0367a9DB231dDeBd88a94b4f6461a6e47C58B1);
    CutoverReporter internal constant REPORTER = CutoverReporter(0x53703Dd6129d723066b6362510E5aE2fECd48218);
    // Current holders of the reporter requester, reporter initializer, MOOv2 proposer whitelist and resolver roles.
    address internal constant REPORTER_MODULE = 0x000012e0009c84078c4924fba808A41b9f67527f;
    address internal constant INITIALIZER = 0x2964a637fEaeA99edf573087E8C3C0C1917D553C;
    address internal constant MOO_PROPOSER = 0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D;
    address internal constant RESOLVER = 0x33965F7D08F61A62B86C1Ab9Be5d82C42F4c3081;

    uint64 internal constant OPERATOR = 2_337_560_110_676_355_148;
    uint64 internal constant FORWARDER = 7_237_382_148_114_414_279;
    uint64 internal constant GUARDIAN = 8_999_118_249_493_605_155;
    uint32 internal constant GRANT_DELAY = 259_200;
    bytes4 internal constant P4 = 0x3a9bd40e;
    bytes4 internal constant COPY = 0x030148a2;
    bytes4 internal constant ESCALATE = 0x6f8a9e87;

    uint256 internal constant FORWARD_DELAY = 345_600;
    bytes32 internal constant ID = "YES_OR_NO_QUERY";
    int256 internal constant YES = 1e18;
    int256 internal constant NO = 0;
    int256 internal constant TOO_EARLY = type(int256).min;
    uint256 internal constant BOND = 500e6;
    uint64 internal constant LIVENESS = 2 hours;

    bytes32 internal constant PRICE_REQUEST_BRIDGED =
        keccak256("PriceRequestBridged(address,bytes32,uint256,bytes,bytes32,bytes32)");
    bytes32 internal constant PRICE_REQUEST_ADDED = keccak256("PriceRequestAdded(bytes32,uint256,bytes,bytes32)");
    bytes32 internal constant MESSAGE_SENT = keccak256("MessageSent(bytes)");

    struct DvmRequest {
        bytes32 identifier;
        uint256 time;
        bytes ancillaryData;
    }

    address internal hsm = makeAddr("hsm");
    address internal requester = makeAddr("requester");
    address internal proposer = makeAddr("proposer");
    address internal disputer = makeAddr("disputer");
    uint256 internal finalFee;
    uint256 internal grantDelayEffect;

    function setUp() public {
        vm.createSelectFork(vm.envString("POLYGON_RPC_URL"), POLYGON_BLOCK);
        // Deployed AccessManager and reporter use opcodes newer than the profile's paris target; the bundled forge-std
        // predates the setEvmVersion binding, so call the cheatcode directly.
        (bool evmSet,) = address(vm).call(abi.encodeWithSignature("setEvmVersion(string)", "prague"));
        assertTrue(evmSet);
        assertEq(address(ROUTER.oracle()), CHILD);
        assertEq(address(ROUTER.legacyOracle()), CHILD);
        assertEq(ROUTER.forwardDelay(), FORWARD_DELAY);
        assertEq(ROUTER.council(), address(COUNCIL));
        assertTrue(COUNCIL.operators(address(MANAGER)));
        assertEq(FINDER.getImplementationAddress("Oracle"), CHILD);
        finalFee = CutoverStore(STORE).computeFinalFee(address(USDC));
        assertGt(finalFee, 0);

        _applySafeRoleSetup();
        _grantHsm(hsm);
        _assertCanCall(hsm, P4, true);
        _assertCanCall(hsm, COPY, true);
        _assertCanCall(hsm, ESCALATE, true);
        _assertCanCall(BACKUP, ESCALATE, true);
        _assertCanCall(BACKUP, P4, false);
        _assertCanCall(BACKUP, COPY, false);
    }

    // 1. OOv2 dispute is held by the router, publicly forwarded after the delay and settled with the DVM price.
    function test_OOv2DisputeHeldThenPublicForwardThenDvmSettle() public {
        _cutover();
        bytes memory question = "q: dispute router cutover fork test, OOv2 public forward";
        (uint256 time, Vm.Log[] memory logs) = _ooDispute(OO_V2, question);
        DvmRequest memory request = _routerRequest(logs, address(OO_V2));
        assertEq(request.time, time);
        _assertHeld(request);
        vm.expectRevert("_settle: not settleable");
        OO_V2.settle(requester, ID, time, question);

        (uint64 requestedAt,,,) = ROUTER.priceRequests(_id(request));
        vm.warp(requestedAt + FORWARD_DELAY - 1);
        vm.expectRevert(
            abi.encodeWithSelector(DisputeRouter.DelayNotPassed.selector, block.timestamp, requestedAt + FORWARD_DELAY)
        );
        ROUTER.forwardPriceRequest(ID, request.time, request.ancillaryData);

        vm.warp(requestedAt + FORWARD_DELAY);
        vm.recordLogs();
        vm.prank(makeAddr("anyone"));
        ROUTER.forwardPriceRequest(ID, request.time, request.ancillaryData);
        bytes memory parentData = _tunnelRequest(vm.getRecordedLogs(), address(ROUTER), request);
        (, uint64 forwardedAt,,) = ROUTER.priceRequests(_id(request));
        assertEq(forwardedAt, block.timestamp);
        vm.expectRevert("_settle: not settleable");
        OO_V2.settle(requester, ID, time, question);

        bytes memory message = abi.encode(ID, request.time, parentData, NO);
        vm.expectRevert("FxBaseChildTunnel: INVALID_SENDER");
        CutoverChildTunnel(CHILD).processMessageFromRoot(1, ROOT_TUNNEL, message);
        vm.prank(FX_CHILD);
        vm.expectRevert("FxBaseChildTunnel: INVALID_SENDER_FROM_ROOT");
        CutoverChildTunnel(CHILD).processMessageFromRoot(1, address(0xBAD), message);

        _pushDvmPrice(request, parentData, NO);
        assertTrue(_routerHasPrice(request));
        _ooSettle(OO_V2, time, question, disputer);
    }

    // 2. Polymarket V2 (OOReporter -> MOOv2): disputes are held; council P4 settles them and the reporter re-requests.
    function test_ReporterDisputesResolvedTooEarlyByCouncil() public {
        _cutover();
        bytes memory rules = "q: dispute router cutover fork test, reporter P4";
        (bytes32 requestId, uint256 t0) = _reporterQuestion(rules);
        DvmRequest memory first = _mooProposeAndDispute(t0, rules);
        _assertHeld(first);
        ReporterRequest memory reporterRequest = REPORTER.getRequest(requestId);
        assertTrue(reporterRequest.automaticDisputeRerequestUsed, "first dispute re-requests automatically");
        uint256 t1 = reporterRequest.requestTimestamp;
        assertGt(t1, t0);
        vm.prank(RESOLVER);
        vm.expectRevert(bytes4(keccak256("RequestNotSettleable()")));
        MOO_V2.settle(address(REPORTER), ID, t0, rules);

        DvmRequest memory second = _mooProposeAndDispute(t1, rules);
        _assertHeld(second);
        reporterRequest = REPORTER.getRequest(requestId);
        assertEq(reporterRequest.requestTimestamp, t1);
        assertTrue(reporterRequest.rerequestAllowed, "second dispute only opens the manual gate");

        _execute(hsm, abi.encodeCall(COUNCIL.resolveManagedAsTooEarly, (address(REPORTER), ID, t1, rules)));
        _assertResolvedLocally(second, TOO_EARLY);
        _mooSettle(t1, rules, disputer);
        reporterRequest = REPORTER.getRequest(requestId);
        assertFalse(reporterRequest.resolved, "P4 must not resolve the reporter");
        assertGt(reporterRequest.requestTimestamp, t1, "P4 settlement re-requests automatically");
        assertFalse(reporterRequest.rerequestAllowed);

        // The superseded first dispute can still be released; the reporter ignores its stale callback.
        _execute(hsm, abi.encodeCall(COUNCIL.resolveManagedAsTooEarly, (address(REPORTER), ID, t0, rules)));
        _assertResolvedLocally(first, TOO_EARLY);
        _mooSettle(t0, rules, disputer);
        assertEq(REPORTER.getRequest(requestId).requestTimestamp, reporterRequest.requestTimestamp);
        assertFalse(REPORTER.getRequest(requestId).resolved);
    }

    // 3. A disputed MOOv2 request settles with the price of its settled follow-up request.
    function test_ReporterDisputeCopiedFromSettledFollowUp() public {
        _cutover();
        bytes memory rules = "q: dispute router cutover fork test, reporter copy";
        (bytes32 requestId, uint256 t0) = _reporterQuestion(rules);
        DvmRequest memory disputed = _mooProposeAndDispute(t0, rules);
        uint256 t1 = REPORTER.getRequest(requestId).requestTimestamp;
        _settleFollowUp(t1, rules, YES);
        assertTrue(REPORTER.getRequest(requestId).resolved);
        assertEq(REPORTER.getRequest(requestId).outcome, YES);
        _assertHeld(disputed);

        _execute(hsm, abi.encodeCall(COUNCIL.resolveManagedFromSettledFollowUp, (address(REPORTER), ID, t0, t1, rules)));
        _assertResolvedLocally(disputed, YES);
        _mooSettle(t0, rules, MOO_PROPOSER);
        assertEq(REPORTER.getRequest(requestId).outcome, YES);
    }

    // 4. Held disputes escalated through the council by the HSM and by the backup forwarder settle with DVM prices.
    function test_CouncilEscalationByHsmAndBackupThenDvmSettle() public {
        _cutover();
        bytes memory questionA = "q: dispute router cutover fork test, HSM escalation";
        bytes memory questionB = "q: dispute router cutover fork test, backup escalation";
        (uint256 timeA, Vm.Log[] memory logsA) = _ooDispute(OO_V2, questionA);
        DvmRequest memory requestA = _routerRequest(logsA, address(OO_V2));
        (uint256 timeB, Vm.Log[] memory logsB) = _ooDispute(OO_V2, questionB);
        DvmRequest memory requestB = _routerRequest(logsB, address(OO_V2));
        (, Vm.Log[] memory logsC) = _ooDispute(OO_V2, "q: dispute router cutover fork test, held in same block");
        DvmRequest memory requestC = _routerRequest(logsC, address(OO_V2));
        // Admission is not metered by the forward budget: all disputes in one block are held.
        _assertHeld(requestA);
        _assertHeld(requestB);
        _assertHeld(requestC);

        bytes memory parentA = _escalate(hsm, requestA);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouter.ForwardBudgetExceeded.selector, block.number));
        _execute(
            BACKUP, abi.encodeCall(COUNCIL.escalateOptimisticOracleRequest, (ID, requestB.time, requestB.ancillaryData))
        );
        vm.roll(block.number + 1);
        bytes memory parentB = _escalate(BACKUP, requestB);
        _assertHeld(requestC);

        _pushDvmPrice(requestA, parentA, YES);
        _pushDvmPrice(requestB, parentB, NO);
        _ooSettle(OO_V2, timeA, questionA, proposer);
        _ooSettle(OO_V2, timeB, questionB, disputer);
    }

    // 5. Disputes raised before the cutover go to the tunnel and settle after it through the router legacy fallback.
    function test_PreCutoverDisputesSettleThroughLegacyFallback() public {
        bytes memory question = "q: dispute router cutover fork test, pre-cutover OOv2";
        (uint256 time, Vm.Log[] memory logs) = _ooDispute(OO_V2, question);
        (DvmRequest memory ooRequest, bytes memory ooParent) = _tunnelRequestFrom(logs, address(OO_V2));
        bytes memory rules = "q: dispute router cutover fork test, pre-cutover reporter";
        (, uint256 t0) = _reporterQuestion(rules);
        vm.warp(block.timestamp + 1);
        _mooPropose(t0, rules, YES);
        (DvmRequest memory mooRequest, bytes memory mooParent) =
            _tunnelRequestFrom(_mooDispute(t0, rules), address(MOO_V2));

        _cutover();
        (uint64 requestedAt,,,) = ROUTER.priceRequests(_id(ooRequest));
        assertEq(requestedAt, 0, "pre-cutover dispute is unknown to the router");
        vm.expectRevert("_settle: not settleable");
        OO_V2.settle(requester, ID, time, question);

        _pushDvmPrice(ooRequest, ooParent, NO);
        _pushDvmPrice(mooRequest, mooParent, YES);
        assertTrue(_routerHasPrice(ooRequest));
        _ooSettle(OO_V2, time, question, disputer);
        _mooSettle(t0, rules, MOO_PROPOSER);
    }

    // 6. OOv1 disputes are held by the router and settle once the DVM resolves them. Skinny OO is not on Polygon.
    function test_OOv1DisputeHeldThenEscalatedThenDvmSettle() public {
        _cutover();
        bytes memory question = "q: dispute router cutover fork test, OOv1";
        (uint256 time, Vm.Log[] memory logs) = _ooDispute(OO_V1, question);
        DvmRequest memory request = _routerRequest(logs, address(OO_V1));
        _assertHeld(request);
        vm.expectRevert("_settle: not settleable");
        OO_V1.settle(requester, ID, time, question);

        bytes memory parentData = _escalate(hsm, request);
        _pushDvmPrice(request, parentData, YES);
        _ooSettle(OO_V1, time, question, proposer);
    }

    // 7. Only the configured roles can act through the council.
    function test_UnauthorizedCallersCannotAct() public {
        _cutover();
        bytes memory rules = "q: dispute router cutover fork test, unauthorized";
        (, uint256 t0) = _reporterQuestion(rules);
        DvmRequest memory request = _mooProposeAndDispute(t0, rules);
        bytes memory p4 = abi.encodeCall(COUNCIL.resolveManagedAsTooEarly, (address(REPORTER), ID, t0, rules));
        // The AccessManager rejects these callers before the council runs, so the follow-up time is a placeholder.
        bytes memory copy =
            abi.encodeCall(COUNCIL.resolveManagedFromSettledFollowUp, (address(REPORTER), ID, t0, t0 + 1, rules));
        bytes memory escalate =
            abi.encodeCall(COUNCIL.escalateOptimisticOracleRequest, (ID, request.time, request.ancillaryData));
        address stranger = makeAddr("stranger");

        _expectUnauthorized(BACKUP, P4, p4);
        _expectUnauthorized(BACKUP, COPY, copy);
        _expectUnauthorized(stranger, P4, p4);
        _expectUnauthorized(stranger, COPY, copy);
        _expectUnauthorized(stranger, ESCALATE, escalate);

        vm.prank(hsm);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouterCouncil.CallerNotOperator.selector, hsm));
        COUNCIL.resolveManagedAsTooEarly(address(REPORTER), ID, t0, rules);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouter.CallerNotCouncil.selector, stranger));
        ROUTER.resolvePriceRequest(ID, request.time, request.ancillaryData, YES);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouter.CallerNotCouncil.selector, stranger));
        ROUTER.escalateNow(ID, request.time, request.ancillaryData);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouter.CallerNotRegistered.selector, stranger));
        ROUTER.requestPrice(ID, block.timestamp, rules);

        // P4 only applies to disputed managed requests, so an OOv2 dispute cannot be resolved as too early.
        bytes memory question = "q: dispute router cutover fork test, OOv2 not managed";
        (uint256 time,) = _ooDispute(OO_V2, question);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouterCouncil.ManagedRequestNotDisputed.selector, requester, ID, time, question
            )
        );
        _execute(hsm, abi.encodeCall(COUNCIL.resolveManagedAsTooEarly, (requester, ID, time, question)));

        _assertHeld(request);
    }

    // 8. A key granted one second before the 72h grant delay takes effect can act immediately.
    function test_GrantInsideWindowIsImmediatelyUsable() public {
        _cutover();
        bytes memory p4Call;
        DvmRequest memory p4Request;
        {
            bytes memory rules = "q: dispute router cutover fork test, window P4";
            (, uint256 time) = _reporterQuestion(rules);
            p4Request = _mooProposeAndDispute(time, rules);
            p4Call = abi.encodeCall(COUNCIL.resolveManagedAsTooEarly, (address(REPORTER), ID, time, rules));
        }
        bytes memory copyCall;
        DvmRequest memory copyRequest;
        {
            bytes memory rules = "q: dispute router cutover fork test, window copy";
            (bytes32 requestId, uint256 time) = _reporterQuestion(rules);
            copyRequest = _mooProposeAndDispute(time, rules);
            uint256 followUpTime = REPORTER.getRequest(requestId).requestTimestamp;
            _settleFollowUp(followUpTime, rules, NO);
            copyCall = abi.encodeCall(
                COUNCIL.resolveManagedFromSettledFollowUp, (address(REPORTER), ID, time, followUpTime, rules)
            );
        }
        (, Vm.Log[] memory logs) = _ooDispute(OO_V2, "q: dispute router cutover fork test, window escalation");
        DvmRequest memory escalateRequest = _routerRequest(logs, address(OO_V2));

        assertLt(block.timestamp, grantDelayEffect - 1);
        vm.warp(grantDelayEffect - 1);
        assertEq(MANAGER.getRoleGrantDelay(OPERATOR), 0);
        assertEq(MANAGER.getRoleGrantDelay(FORWARDER), 0);
        address lateHsm = makeAddr("hsm granted inside window");
        _grantHsm(lateHsm);
        _assertCanCall(lateHsm, P4, true);
        _assertCanCall(lateHsm, COPY, true);
        _assertCanCall(lateHsm, ESCALATE, true);

        _execute(lateHsm, p4Call);
        _assertResolvedLocally(p4Request, TOO_EARLY);
        _execute(lateHsm, copyCall);
        _assertResolvedLocally(copyRequest, NO);
        _escalate(lateHsm, escalateRequest);
    }

    // 9. From the effect timepoint on, new grants wait the full 72h grant delay.
    function test_GrantAfterWindowWaitsGrantDelay() public {
        _cutover();
        bytes memory rules = "q: dispute router cutover fork test, after window";
        (, uint256 t0) = _reporterQuestion(rules);
        DvmRequest memory request = _mooProposeAndDispute(t0, rules);
        bytes memory p4 = abi.encodeCall(COUNCIL.resolveManagedAsTooEarly, (address(REPORTER), ID, t0, rules));

        vm.warp(grantDelayEffect);
        assertEq(MANAGER.getRoleGrantDelay(OPERATOR), GRANT_DELAY);
        assertEq(MANAGER.getRoleGrantDelay(FORWARDER), GRANT_DELAY);
        address hsmAtEffect = makeAddr("hsm granted at effect");
        _grantHsm(hsmAtEffect);
        _assertCanCall(hsmAtEffect, P4, false);
        _assertCanCall(hsmAtEffect, ESCALATE, false);
        _expectUnauthorized(hsmAtEffect, P4, p4);

        vm.warp(grantDelayEffect + 1);
        address hsmAfterEffect = makeAddr("hsm granted after effect");
        _grantHsm(hsmAfterEffect);
        _assertCanCall(hsmAfterEffect, P4, false);

        vm.warp(grantDelayEffect + GRANT_DELAY - 1);
        _assertCanCall(hsmAtEffect, P4, false);
        _assertCanCall(hsmAtEffect, ESCALATE, false);
        _expectUnauthorized(hsmAtEffect, P4, p4);

        vm.warp(grantDelayEffect + GRANT_DELAY);
        _assertCanCall(hsmAtEffect, P4, true);
        _assertCanCall(hsmAtEffect, ESCALATE, true);
        _assertCanCall(hsmAfterEffect, P4, false);
        _execute(hsmAtEffect, p4);
        _assertResolvedLocally(request, TOO_EARLY);

        vm.warp(grantDelayEffect + 1 + GRANT_DELAY);
        _assertCanCall(hsmAfterEffect, P4, true);
    }

    // 10. A Polymarket V2 dispute forwarded to the DVM settles and resolves the reporter with the DVM outcome.
    function test_ReporterDisputeForwardedToDvmResolvesReporter() public {
        _cutover();
        bytes memory rules = "q: dispute router cutover fork test, reporter DVM";
        (bytes32 requestId, uint256 t0) = _reporterQuestion(rules);
        DvmRequest memory first = _mooProposeAndDispute(t0, rules);
        uint256 t1 = REPORTER.getRequest(requestId).requestTimestamp;
        DvmRequest memory second = _mooProposeAndDispute(t1, rules);

        (uint64 requestedAt,,,) = ROUTER.priceRequests(_id(first));
        vm.warp(requestedAt + FORWARD_DELAY);
        vm.recordLogs();
        ROUTER.forwardPriceRequest(ID, first.time, first.ancillaryData);
        bytes memory parentFirst = _tunnelRequest(vm.getRecordedLogs(), address(ROUTER), first);
        vm.roll(block.number + 1);
        bytes memory parentSecond = _escalate(hsm, second);
        vm.expectRevert(abi.encodeWithSelector(DisputeRouter.CannotResolveAfterForwarding.selector, _id(second)));
        _execute(hsm, abi.encodeCall(COUNCIL.resolveManagedAsTooEarly, (address(REPORTER), ID, t1, rules)));

        _pushDvmPrice(first, parentFirst, YES);
        _pushDvmPrice(second, parentSecond, NO);
        _mooSettle(t0, rules, MOO_PROPOSER);
        assertFalse(REPORTER.getRequest(requestId).resolved, "superseded request does not resolve the reporter");
        _mooSettle(t1, rules, disputer);
        assertTrue(REPORTER.getRequest(requestId).resolved);
        assertEq(REPORTER.getRequest(requestId).outcome, NO);
    }

    // 11. Polymarket V1 (UmaCtfAdapter on OOv2): the first dispute resets the question, the second is escalated and
    // the DVM answer resolves the market.
    function test_PolymarketV1AdapterDisputeEscalatedThenResolved() public {
        _cutover();
        vm.prank(requester);
        bytes32 questionId =
            CTF_ADAPTER.initialize("q: dispute router cutover fork test, Polymarket V1", address(USDC), 0, BOND, 0);
        AdapterQuestion memory question = CTF_ADAPTER.getQuestion(questionId);
        uint256 t0 = question.requestTimestamp;
        vm.warp(block.timestamp + 1);
        DvmRequest memory first = _routerRequest(
            _ooProposeAndDispute(OO_V2, address(CTF_ADAPTER), t0, question.ancillaryData), address(OO_V2)
        );
        _assertHeld(first);
        question = CTF_ADAPTER.getQuestion(questionId);
        assertTrue(question.reset, "first dispute resets the question");
        uint256 t1 = question.requestTimestamp;
        assertGt(t1, t0);

        vm.warp(block.timestamp + 1);
        DvmRequest memory second = _routerRequest(
            _ooProposeAndDispute(OO_V2, address(CTF_ADAPTER), t1, question.ancillaryData), address(OO_V2)
        );
        _assertHeld(second);
        question = CTF_ADAPTER.getQuestion(questionId);
        assertEq(question.requestTimestamp, t1, "second dispute keeps the question on the disputed request");
        assertTrue(question.refund);
        assertFalse(CTF_ADAPTER.ready(questionId));

        bytes memory parentSecond = _escalate(hsm, second);
        vm.roll(block.number + 1);
        bytes memory parentFirst = _escalate(hsm, first);
        _pushDvmPrice(second, parentSecond, NO);
        _pushDvmPrice(first, parentFirst, YES);
        assertTrue(CTF_ADAPTER.ready(questionId));

        uint256 balance = USDC.balanceOf(disputer);
        CTF_ADAPTER.resolve(questionId);
        assertTrue(CTF_ADAPTER.getQuestion(questionId).resolved);
        assertEq(
            USDC.balanceOf(disputer) - balance, BOND + BOND - BOND / 2 + finalFee, "resolve settles the OOv2 bonds"
        );
        // The request superseded by the reset still settles its bonds.
        _ooSettleFor(OO_V2, address(CTF_ADAPTER), t0, question.ancillaryData, proposer);
    }

    // 12. OOv3 keeps its cached tunnel until anyone syncs it; disputes on either side of the sync settle.
    function test_OOv3DisputesBeforeAndAfterSyncSettle() public {
        _cutover();
        (bytes32 preSync, Vm.Log[] memory preLogs) = _ooV3AssertAndDispute("dispute router cutover fork test, pre-sync");
        (DvmRequest memory preRequest, bytes memory preParent) = _tunnelRequestFrom(preLogs, address(OO_V3));

        vm.prank(makeAddr("anyone"));
        OO_V3.syncUmaParams(ASSERT_TRUTH2, address(NATIVE_USDC));
        assertEq(OO_V3.cachedOracle(), address(ROUTER));

        (bytes32 postSync, Vm.Log[] memory postLogs) =
            _ooV3AssertAndDispute("dispute router cutover fork test, post-sync");
        DvmRequest memory postRequest = _routerRequest(postLogs, address(OO_V3));
        _assertHeld(postRequest);
        vm.expectRevert(
            abi.encodeWithSelector(
                DisputeRouter.PriceWasNeverRequested.selector,
                preRequest.identifier,
                preRequest.time,
                preRequest.ancillaryData
            )
        );
        OO_V3.settleAssertion(preSync);

        _pushDvmPrice(preRequest, preParent, YES);
        OO_V3.settleAssertion(preSync);
        assertTrue(OO_V3.getAssertionResult(preSync), "pre-sync dispute settles through the legacy fallback");

        bytes memory postParent = _escalate(hsm, postRequest);
        _pushDvmPrice(postRequest, postParent, NO);
        OO_V3.settleAssertion(postSync);
        assertFalse(OO_V3.getAssertionResult(postSync));
    }

    // ========== Governance and role setup ==========

    /// @dev Effect of the governance proposal on Polygon, as executed by GovernorChildTunnel.
    function _cutover() internal {
        vm.startPrank(GOVERNOR);
        REGISTRY.addMember(1, GOVERNOR);
        REGISTRY.registerContract(new address[](0), address(ROUTER));
        REGISTRY.removeMember(1, GOVERNOR);
        FINDER.changeImplementationAddress("Oracle", address(ROUTER));
        vm.stopPrank();

        assertEq(FINDER.getImplementationAddress("Oracle"), address(ROUTER));
        assertTrue(REGISTRY.isContractRegistered(address(ROUTER)));
        assertFalse(REGISTRY.holdsRole(1, GOVERNOR));
        // OOv3 is out of scope: it keeps its cached tunnel until syncUmaParams is called.
        assertEq(OO_V3.cachedOracle(), CHILD);
    }

    /// @dev The 13 calls of the queued Safe MultiSend, replayed as the Safe.
    function _applySafeRoleSetup() internal {
        bytes4[] memory managedSelectors = new bytes4[](2);
        managedSelectors[0] = P4;
        managedSelectors[1] = COPY;
        bytes4[] memory escalateSelectors = new bytes4[](1);
        escalateSelectors[0] = ESCALATE;

        vm.recordLogs();
        vm.startPrank(SAFE);
        MANAGER.labelRole(OPERATOR, "DISPUTE_ROUTER_COUNCIL_OPERATOR_V1");
        MANAGER.labelRole(FORWARDER, "DISPUTE_ROUTER_COUNCIL_FORWARDER_V1");
        MANAGER.labelRole(GUARDIAN, "DISPUTE_ROUTER_COUNCIL_GUARDIAN_V1");
        MANAGER.setTargetFunctionRole(address(COUNCIL), managedSelectors, OPERATOR);
        MANAGER.setTargetFunctionRole(address(COUNCIL), escalateSelectors, FORWARDER);
        MANAGER.grantRole(GUARDIAN, SAFE, 0);
        MANAGER.setRoleAdmin(OPERATOR, GUARDIAN);
        MANAGER.setRoleGuardian(OPERATOR, GUARDIAN);
        MANAGER.setRoleAdmin(FORWARDER, GUARDIAN);
        MANAGER.setRoleGuardian(FORWARDER, GUARDIAN);
        MANAGER.grantRole(FORWARDER, BACKUP, 0);
        MANAGER.setGrantDelay(OPERATOR, GRANT_DELAY);
        MANAGER.setGrantDelay(FORWARDER, GRANT_DELAY);
        vm.stopPrank();

        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 changes;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter != address(MANAGER)
                    || logs[i].topics[0] != IAccessManager.RoleGrantDelayChanged.selector
            ) {
                continue;
            }
            (uint32 delay, uint48 since) = abi.decode(logs[i].data, (uint32, uint48));
            assertEq(delay, GRANT_DELAY);
            assertEq(since, block.timestamp + MANAGER.minSetback());
            grantDelayEffect = since;
            ++changes;
        }
        assertEq(changes, 2);
        assertEq(MANAGER.getRoleGrantDelay(OPERATOR), 0, "grant delay is not active yet");
    }

    function _grantHsm(address account) internal {
        vm.startPrank(SAFE);
        MANAGER.grantRole(OPERATOR, account, 0);
        MANAGER.grantRole(FORWARDER, account, 0);
        vm.stopPrank();
    }

    function _assertCanCall(address caller, bytes4 selector, bool expected) internal view {
        (bool immediate, uint32 delay) = MANAGER.canCall(caller, address(COUNCIL), selector);
        assertEq(immediate, expected);
        assertEq(delay, 0);
    }

    function _execute(address caller, bytes memory data) internal {
        vm.prank(caller);
        MANAGER.execute(address(COUNCIL), data);
    }

    function _expectUnauthorized(address caller, bytes4 selector, bytes memory data) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessManager.AccessManagerUnauthorizedCall.selector, caller, address(COUNCIL), selector
            )
        );
        _execute(caller, data);
    }

    // ========== Router and tunnel ==========

    function _escalate(address caller, DvmRequest memory request) internal returns (bytes memory parentData) {
        vm.recordLogs();
        _execute(
            caller,
            abi.encodeCall(
                COUNCIL.escalateOptimisticOracleRequest, (request.identifier, request.time, request.ancillaryData)
            )
        );
        parentData = _tunnelRequest(vm.getRecordedLogs(), address(ROUTER), request);
        (, uint64 forwardedAt, bool resolved,) = ROUTER.priceRequests(_id(request));
        assertEq(forwardedAt, block.timestamp);
        assertFalse(resolved);
    }

    /// @dev Delivers the DVM answer as the Polygon state receiver would, from the Ethereum root tunnel.
    function _pushDvmPrice(DvmRequest memory request, bytes memory parentData, int256 price) internal {
        vm.prank(FX_CHILD);
        CutoverChildTunnel(CHILD)
            .processMessageFromRoot(1, ROOT_TUNNEL, abi.encode(request.identifier, request.time, parentData, price));
    }

    function _routerRequest(Vm.Log[] memory logs, address oo) internal pure returns (DvmRequest memory request) {
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            assertFalse(logs[i].emitter == CHILD, "dispute must not reach the tunnel");
            if (logs[i].emitter == address(ROUTER) && logs[i].topics[0] == DisputeRouter.RequestAdded.selector) {
                assertEq(logs[i].topics[1], bytes32(uint256(uint160(oo))));
                request.identifier = logs[i].topics[2];
                (request.time, request.ancillaryData) = abi.decode(logs[i].data, (uint256, bytes));
                found = true;
            }
        }
        assertTrue(found, "dispute must land in the router");
    }

    /// @dev Returns the child request bridged by `requester` and the compressed ancillary data sent to Ethereum.
    function _tunnelRequestFrom(
        Vm.Log[] memory logs,
        address bridgedRequester
    )
        internal
        pure
        returns (DvmRequest memory request, bytes memory parentData)
    {
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == CHILD && logs[i].topics[0] == PRICE_REQUEST_BRIDGED) {
                assertEq(logs[i].topics[1], bytes32(uint256(uint160(bridgedRequester))));
                (request.identifier, request.time, request.ancillaryData) =
                    abi.decode(logs[i].data, (bytes32, uint256, bytes));
                found = true;
            }
        }
        assertTrue(found, "request must be bridged by the tunnel");
        parentData = _parentData(logs, request);
    }

    function _tunnelRequest(
        Vm.Log[] memory logs,
        address bridgedRequester,
        DvmRequest memory expected
    )
        internal
        pure
        returns (bytes memory parentData)
    {
        DvmRequest memory request;
        (request, parentData) = _tunnelRequestFrom(logs, bridgedRequester);
        assertEq(_id(request), _id(expected));
    }

    function _parentData(
        Vm.Log[] memory logs,
        DvmRequest memory request
    )
        internal
        pure
        returns (bytes memory parentData)
    {
        bool sent;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != CHILD) continue;
            if (logs[i].topics[0] == PRICE_REQUEST_ADDED) {
                assertEq(logs[i].topics[1], request.identifier);
                uint256 parentTime;
                (parentTime, parentData) = abi.decode(logs[i].data, (uint256, bytes));
                assertEq(parentTime, request.time);
            } else if (logs[i].topics[0] == MESSAGE_SENT) {
                assertEq(abi.decode(logs[i].data, (bytes)), abi.encode(request.identifier, request.time, parentData));
                sent = true;
            }
        }
        assertTrue(sent, "tunnel must send the request to Ethereum");
    }

    function _assertHeld(DvmRequest memory request) internal {
        (uint64 requestedAt, uint64 forwardedAt, bool resolved,) = ROUTER.priceRequests(_id(request));
        assertGt(requestedAt, 0);
        assertEq(forwardedAt, 0);
        assertFalse(resolved);
        assertFalse(_routerHasPrice(request));
    }

    function _assertResolvedLocally(DvmRequest memory request, int256 price) internal view {
        (, uint64 forwardedAt, bool resolved, int256 resolvedPrice) = ROUTER.priceRequests(_id(request));
        assertEq(forwardedAt, 0);
        assertTrue(resolved);
        assertEq(resolvedPrice, price);
    }

    function _routerHasPrice(DvmRequest memory request) internal returns (bool) {
        vm.prank(address(OO_V2));
        return ROUTER.hasPrice(request.identifier, request.time, request.ancillaryData);
    }

    function _id(DvmRequest memory request) internal pure returns (bytes32) {
        return keccak256(abi.encode(request.identifier, request.time, request.ancillaryData));
    }

    // ========== OOv1 / OOv2 ==========

    function _ooDispute(
        CutoverOptimisticOracle oo,
        bytes memory question
    )
        internal
        returns (uint256 time, Vm.Log[] memory logs)
    {
        time = block.timestamp;
        vm.startPrank(requester);
        oo.requestPrice(ID, time, question, USDC, 0);
        oo.setBond(ID, time, question, BOND);
        vm.stopPrank();
        logs = _ooProposeAndDispute(oo, requester, time, question);
    }

    function _ooProposeAndDispute(
        CutoverOptimisticOracle oo,
        address ooRequester,
        uint256 time,
        bytes memory question
    )
        internal
        returns (Vm.Log[] memory logs)
    {
        _fund(proposer, address(oo), BOND + finalFee);
        _fund(disputer, address(oo), BOND + finalFee);
        vm.prank(proposer);
        oo.proposePrice(ooRequester, ID, time, question, YES);

        uint256 storeBalance = USDC.balanceOf(STORE);
        vm.recordLogs();
        vm.prank(disputer);
        oo.disputePrice(ooRequester, ID, time, question);
        logs = vm.getRecordedLogs();
        assertEq(USDC.balanceOf(STORE) - storeBalance, finalFee + BOND / 2, "final fee and burned bond to Store");
    }

    function _ooSettle(CutoverOptimisticOracle oo, uint256 time, bytes memory question, address winner) internal {
        _ooSettleFor(oo, requester, time, question, winner);
    }

    function _ooSettleFor(
        CutoverOptimisticOracle oo,
        address ooRequester,
        uint256 time,
        bytes memory question,
        address winner
    )
        internal
    {
        uint256 balance = USDC.balanceOf(winner);
        uint256 payout = oo.settle(ooRequester, ID, time, question);
        assertEq(payout, BOND + BOND - BOND / 2 + finalFee);
        assertEq(USDC.balanceOf(winner) - balance, payout);
    }

    function _ooV3AssertAndDispute(bytes memory claim) internal returns (bytes32 assertionId, Vm.Log[] memory logs) {
        uint256 bond = OO_V3.getMinimumBond(address(NATIVE_USDC));
        _fund(NATIVE_USDC, proposer, address(OO_V3), bond);
        _fund(NATIVE_USDC, disputer, address(OO_V3), bond);
        vm.prank(proposer);
        assertionId = OO_V3.assertTruth(
            claim, proposer, address(0), address(0), LIVENESS, NATIVE_USDC, bond, ASSERT_TRUTH2, bytes32(0)
        );
        vm.recordLogs();
        vm.prank(disputer);
        OO_V3.disputeAssertion(assertionId, disputer);
        logs = vm.getRecordedLogs();
    }

    // ========== OOReporter / Managed OOv2 ==========

    function _reporterQuestion(bytes memory rules) internal returns (bytes32 requestId, uint256 time) {
        requestId = keccak256(rules);
        vm.prank(REPORTER_MODULE);
        REPORTER.registerRequest(requestId, ID, rules, 5 minutes, LIVENESS);
        vm.prank(INITIALIZER);
        REPORTER.initializeRequest(requestId, 0, 0, LIVENESS);
        time = block.timestamp;
        assertEq(REPORTER.getRequest(requestId).requestTimestamp, time);
    }

    function _mooProposeAndDispute(uint256 time, bytes memory rules) internal returns (DvmRequest memory request) {
        vm.warp(block.timestamp + 1);
        _mooPropose(time, rules, YES);
        vm.warp(block.timestamp + 1);
        request = _routerRequest(_mooDispute(time, rules), address(MOO_V2));
        assertEq(request.time, MOO_V2.getRequest(address(REPORTER), ID, time, rules).proposalTime);
        assertEq(request.ancillaryData, MOO_V2.stampAncillaryData(rules, address(REPORTER)));
    }

    function _mooPropose(uint256 time, bytes memory rules, int256 price) internal {
        _fund(MOO_PROPOSER, address(MOO_V2), 10_000e6);
        vm.prank(MOO_PROPOSER);
        MOO_V2.proposePriceFor(MOO_PROPOSER, address(REPORTER), ID, time, rules, price);
    }

    function _mooDispute(uint256 time, bytes memory rules) internal returns (Vm.Log[] memory logs) {
        _fund(disputer, address(MOO_V2), 10_000e6);
        vm.recordLogs();
        vm.prank(disputer);
        MOO_V2.disputePrice(address(REPORTER), ID, time, rules);
        logs = vm.getRecordedLogs();
    }

    function _settleFollowUp(uint256 time, bytes memory rules, int256 price) internal {
        vm.warp(block.timestamp + 1);
        _mooPropose(time, rules, price);
        vm.warp(block.timestamp + LIVENESS);
        _mooSettle(time, rules, MOO_PROPOSER);
    }

    function _mooSettle(uint256 time, bytes memory rules, address winner) internal {
        IManagedOptimisticOracleV2ForCouncil.Request memory request =
            MOO_V2.getRequest(address(REPORTER), ID, time, rules);
        uint256 bond = request.requestSettings.bond;
        uint256 expected = request.disputer == address(0)
            ? bond + request.finalFee + request.reward
            : bond + bond - bond / 2 + request.finalFee + request.reward;
        uint256 balance = USDC.balanceOf(winner);
        vm.prank(RESOLVER);
        uint256 payout = MOO_V2.settle(address(REPORTER), ID, time, rules);
        assertEq(payout, expected);
        assertEq(USDC.balanceOf(winner) - balance, payout);
    }

    function _fund(address account, address spender, uint256 amount) internal {
        _fund(USDC, account, spender, amount);
    }

    function _fund(IERC20 token, address account, address spender, uint256 amount) internal {
        deal(address(token), account, token.balanceOf(account) + amount);
        vm.prank(account);
        token.approve(spender, type(uint256).max);
    }
}
