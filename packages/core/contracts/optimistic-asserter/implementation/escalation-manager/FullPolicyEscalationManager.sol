pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./BaseEscalationManager.sol";
import "../../interfaces/OptimisticAsserterInterface.sol";

contract FullPolicyEscalationManager is BaseEscalationManager, Ownable {
    struct ArbitrationResolution {
        bool valueSet;
        bool resolution;
    }

    enum AssertionBlockOption { None, BlockByAsserter, BlockByAssertingCaller }

    AssertionBlockOption public assertionBlockOption;

    bool public arbitrateViaEscalationManager;

    bool public discardOracle;

    address public allowedAssertingCaller;

    bool public validateDisputers;

    mapping(bytes32 => ArbitrationResolution) public arbitrationResolutions;

    mapping(address => bool) public whitelistedDisputeCallers;

    mapping(address => bool) public whitelistedAssertingCallers;

    mapping(address => mapping(address => bool)) public whitelistedAssertersByAssertingCaller;

    function getPrice(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData
    ) public view override returns (int256) {
        bytes32 requestId = keccak256(abi.encode(identifier, time, ancillaryData));
        require(arbitrationResolutions[requestId].valueSet, "Arbitration resolution not set");
        if (arbitrationResolutions[requestId].resolution) return 1e18;
        return 0;
    }

    function getAssertionPolicy(bytes32 assertionId) public view override returns (AssertionPolicy memory) {
        OptimisticAsserterInterface optimisticAsserter = OptimisticAsserterInterface(msg.sender);
        OptimisticAsserterInterface.Assertion memory assertion = optimisticAsserter.getAssertion(assertionId);
        bool blocked = _checkIfAssertionBlocked(assertion);
        return
            AssertionPolicy({
                blockAssertion: blocked,
                arbitrateViaEscalationManager: arbitrateViaEscalationManager,
                discardOracle: discardOracle,
                validateDisputers: validateDisputers
            });
    }

    function isDisputeAllowed(bytes32 assertionId, address disputeCaller) public view override returns (bool) {
        return whitelistedDisputeCallers[disputeCaller];
    }

    function configureEscalationManager(
        address _assertingCaller,
        bool _validateDisputers,
        bool _arbitrateViaEscalationManager,
        bool _discardOracle,
        AssertionBlockOption _assertionBlockOption
    ) public onlyOwner {
        allowedAssertingCaller = _assertingCaller;
        validateDisputers = _validateDisputers;
        arbitrateViaEscalationManager = _arbitrateViaEscalationManager;
        discardOracle = _discardOracle;
        assertionBlockOption = _assertionBlockOption;
    }

    function setArbitrationResolution(
        bytes32 identifier,
        uint256 time,
        bytes memory ancillaryData,
        bool arbitrationResolution
    ) public onlyOwner {
        bytes32 requestId = keccak256(abi.encode(identifier, time, ancillaryData));
        arbitrationResolutions[requestId] = ArbitrationResolution(true, arbitrationResolution);
    }

    function setDisputeCallerInWhitelist(address disputeCaller, bool value) public onlyOwner {
        whitelistedDisputeCallers[disputeCaller] = value;
    }

    function setAssertingCallerInWhitelist(address assertingCaller, bool value) public onlyOwner {
        whitelistedAssertingCallers[assertingCaller] = value;
    }

    function setWhitelistedAssertersByAssertingCaller(
        address assertingCaller,
        address asserter,
        bool value
    ) public onlyOwner {
        whitelistedAssertersByAssertingCaller[assertingCaller][asserter] = value;
    }

    function _checkIfAssertionBlocked(OptimisticAsserterInterface.Assertion memory assertion)
        internal
        view
        returns (bool)
    {
        if (assertionBlockOption == AssertionBlockOption.BlockByAsserter) {
            if (assertion.escalationManagerSettings.assertingCaller == allowedAssertingCaller)
                return !whitelistedAssertersByAssertingCaller[allowedAssertingCaller][assertion.asserter];
            return true;
        }
        if (assertionBlockOption == AssertionBlockOption.BlockByAssertingCaller) {
            return !whitelistedAssertingCallers[assertion.escalationManagerSettings.assertingCaller];
        }
        return false;
    }
}
