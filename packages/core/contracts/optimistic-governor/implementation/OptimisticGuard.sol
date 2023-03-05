// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.6;

// https://github.com/gnosis/zodiac/blob/master/contracts/guard/BaseGuard.sol
import "@gnosis.pm/zodiac/contracts/guard/BaseGuard.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../data-verification-mechanism/implementation/Constants.sol";
import "../../data-verification-mechanism/interfaces/FinderInterface.sol";
import "../../data-verification-mechanism/interfaces/IdentifierWhitelistInterface.sol";
import "../../data-verification-mechanism/interfaces/StoreInterface.sol";

import "../../optimistic-oracle-v3/implementation/ClaimData.sol";
import "../../optimistic-oracle-v3/interfaces/OptimisticOracleV3Interface.sol";
import "../../optimistic-oracle-v3/interfaces/OptimisticOracleV3CallbackRecipientInterface.sol";

import "../../common/implementation/Lockable.sol";
import "../../common/interfaces/AddressWhitelistInterface.sol";

/**
 * @title Optimistic Guard
 * @notice A contract that allows cancelation of transactions proposed from an Optimistic Governor, without disputing the proposal. This is useful if a user wants to cancel a transaction that was correctly proposed according to the Optimistic Governor rules. For instance, a user may delegate control to an app's account for gasless transactions, but revoke those permissions later.
 */
contract OptimisticGuard is OptimisticOracleV3CallbackRecipientInterface, BaseGuard, Lockable {
    using SafeERC20 for IERC20;

    event OptimisticGuardDeployed(address indexed avatar, address indexed module);

    event ProposalCanceled(bytes32 indexed assertionId);

    event ProposerBlocked(address indexed proposer);

    event SetBond(IERC20 indexed collateral, uint256 indexed bondAmount);

    event SetCollateral(IERC20 indexed collateral);

    event SetRules(string rules);

    event SetLiveness(uint64 indexed liveness);

    event SetIdentifier(bytes32 indexed identifier);

    event SetEscalationManager(address indexed escalationManager);

    FinderInterface public immutable finder; // Finder used to discover other UMA ecosystem contracts.

    IERC20 public collateral; // Collateral currency used to assert proposed transactions.
    uint64 public liveness; // The amount of time to dispute proposed transactions before they can be executed.
    uint256 public bondAmount; // Configured amount of collateral currency to make assertions for proposed transactions.
    string public rules; // Rules for the Optimistic Governor.
    bytes32 public identifier; // Identifier used to request price from the DVM, compatible with Optimistic Oracle V3.
    OptimisticOracleV3Interface public optimisticOracleV3; // Optimistic Oracle V3 contract used to assert proposed transactions.
    address public escalationManager; // Optional Escalation Manager contract to whitelist proposers / disputers.

    mapping(bytes32 => bool) public assertionBlocked; // Maps assertionIds to canceled status.

    /**
     * @notice Construct Optimistic Governor module.
     * @param _finder Finder address.
     * @param _owner Address of the owner.
     * @param _collateral Address of the ERC20 collateral used for bonds.
     * @param _bondAmount Amount of collateral currency to make assertions for proposed transactions
     * @param _rules Reference to the rules for the Optimistic Governor.
     * @param _identifier The approved identifier to be used with the contract, compatible with Optimistic Oracle V3.
     * @param _liveness The period, in seconds, in which a proposal can be disputed.
     */
    constructor(
        address _finder,
        address _owner,
        address _module,
        address _collateral,
        uint256 _bondAmount,
        string memory _rules,
        bytes32 _identifier,
        uint64 _liveness
    ) {
        bytes memory initializeParams =
            abi.encode(_owner, _module, _collateral, _bondAmount, _rules, _identifier, _liveness);
        require(_finder != address(0), "Finder address can not be empty");
        finder = FinderInterface(_finder);
        setUp(initializeParams);
    }

    /**
     * @notice Sets up the Optimistic Guard.
     * @param initializeParams ABI encoded parameters to initialize the guard with.
     * @dev This method can be called only either by the constructor or as part of first time initialization when
     * cloning the guard.
     */
    function setUp(bytes memory initializeParams) public override initializer {
        _startReentrantGuardDisabled();
        __Ownable_init();
        (
            address _owner,
            address _module,
            address _collateral,
            uint256 _bondAmount,
            string memory _rules,
            bytes32 _identifier,
            uint64 _liveness
        ) = abi.decode(initializeParams, (address, address, address, uint256, string, bytes32, uint64));
        setCollateralAndBond(IERC20(_collateral), _bondAmount);
        setRules(_rules);
        setIdentifier(_identifier);
        setLiveness(_liveness);
        setAvatar(_owner);
        setTarget(_owner);
        transferOwnership(_owner);
        _sync();

        emit OptimisticGuardDeployed(avatar, module);
    }

    /**
     * @notice Sets the collateral and bond amount for proposals.
     * @param _collateral token that will be used for all bonds for the contract.
     * @param _bondAmount amount of the bond token that will need to be paid for future proposals.
     */
    function setCollateralAndBond(IERC20 _collateral, uint256 _bondAmount) public onlyOwner {
        // ERC20 token to be used as collateral (must be approved by UMA governance).
        require(_getCollateralWhitelist().isOnWhitelist(address(_collateral)), "Bond token not supported");
        collateral = _collateral;

        // Value of the bond posted for asserting the proposed transactions. If the minimum amount required by
        // Optimistic Oracle V3 is higher this contract will attempt to pull the required bond amount.
        bondAmount = _bondAmount;
        emit SetBond(_collateral, _bondAmount);
    }

    /**
     * @notice Sets the rules that will be used to evaluate future proposals.
     * @param _rules string that outlines or references the location where the rules can be found.
     */
    function setRules(string memory _rules) public onlyOwner {
        // Set reference to the rules for the Optimistic Governor
        require(bytes(_rules).length > 0, "Rules can not be empty");
        rules = _rules;
        emit SetRules(_rules);
    }

    /**
     * @notice Sets the liveness for future proposals. This is the amount of delay before a proposal is approved by
     * default.
     * @param _liveness liveness to set in seconds.
     */
    function setLiveness(uint64 _liveness) public onlyOwner {
        // Set liveness for disputing proposed transactions.
        require(_liveness > 0, "Liveness can't be 0");
        require(_liveness < 5200 weeks, "Liveness must be less than 5200 weeks");
        liveness = _liveness;
        emit SetLiveness(_liveness);
    }

    /**
     * @notice Sets the identifier for future proposals.
     * @param _identifier identifier to set.
     */
    function setIdentifier(bytes32 _identifier) public onlyOwner {
        // Set identifier which is used along with the rules to determine if transactions are valid.
        require(_getIdentifierWhitelist().isIdentifierSupported(_identifier), "Identifier not supported");
        identifier = _identifier;
        emit SetIdentifier(_identifier);
    }

    /**
     * @notice Sets the Escalation Manager for future proposals.
     * @param _escalationManager address of the Escalation Manager, can be zero to disable this functionality.
     * @dev Only the owner can call this method. The provided address must conform to the Escalation Manager interface.
     * FullPolicyEscalationManager can be used, but within the context of this contract it should be used only for
     * whitelisting of proposers and disputers since Optimistic Governor is deleting disputed proposals.
     */
    function setEscalationManager(address _escalationManager) external onlyOwner {
        escalationManager = _escalationManager;
        emit SetEscalationManager(_escalationManager);
    }

    /**
     * @notice This caches the most up-to-date Optimistic Oracle V3.
     * @dev If a new Optimistic Oracle V3 is added and this is run between a proposal's introduction and execution, the
     * proposal will become unexecutable.
     */
    function sync() external nonReentrant {
        _sync();
    }

    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures,
        address msgSender
    ) external {}

    function checkAfterExecution(bytes32 txHash, bool success) external {}

    // Proposals can be canceled or proposers blocked according to the Guard's rules, but this requires posting a bond to prevent griefing.
    function cancelProposal(uint256 assertionId) external {}

    function blockProposer(address proposer) external {}

    /**
     * @notice Callback to automatically delete a proposal that was disputed.
     * @param assertionId the identifier of the disputed assertion.
     */
    function assertionDisputedCallback(bytes32 assertionId) external {
        // In order to optimize for happy path, the assertionId is validated for potential spoofing only in the
        // deleteProposalOnUpgrade call. Genuine Optimistic Oracle V3 should always pass a valid assertionId that has a
        // matching proposalHash in this contract.
        bytes32 proposalHash = assertionIds[assertionId];

        // Callback should only be called by the Optimistic Oracle V3. Address would not match in case of contract
        // upgrade, thus try deleting the proposal through deleteProposalOnUpgrade function that should revert if
        // address mismatch was not caused by an Optimistic Oracle V3 upgrade.
        if (msg.sender == address(optimisticOracleV3)) {
            // Delete the disputed proposal and associated assertionId.
            delete proposalHashes[proposalHash];
            delete assertionIds[assertionId];

            emit ProposalDeleted(proposalHash, assertionId);
        } else deleteProposalOnUpgrade(proposalHash);
    }

    /**
     * @notice Callback function that is called by Optimistic Oracle V3 when an assertion is resolved.
     * @dev This function does nothing and is only here to satisfy the callback recipient interface.
     * @param assertionId The identifier of the assertion that was resolved.
     * @param assertedTruthfully Whether the assertion was resolved as truthful or not.
     */
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) external {}

    /**
     * @notice Gets the current time for this contract.
     * @dev This only exists so it can be overridden for testing.
     */
    function getCurrentTime() public view virtual returns (uint256) {
        return block.timestamp;
    }

    /**
     * @notice Getter function to check required collateral currency approval.
     * @return The amount of bond required to propose a transaction.
     */
    function getProposalBond() public view returns (uint256) {
        uint256 minimumBond = optimisticOracleV3.getMinimumBond(address(collateral));
        return minimumBond > bondAmount ? minimumBond : bondAmount;
    }

    // Gets the address of Collateral Whitelist from the Finder.
    function _getCollateralWhitelist() internal view returns (AddressWhitelistInterface) {
        return AddressWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.CollateralWhitelist));
    }

    // Gets the address of Identifier Whitelist from the Finder.
    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return IdentifierWhitelistInterface(finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist));
    }

    // Gets the address of Store contract from the Finder.
    function _getStore() internal view returns (StoreInterface) {
        return StoreInterface(finder.getImplementationAddress(OracleInterfaces.Store));
    }

    // Caches the address of the Optimistic Oracle V3 from the Finder.
    function _sync() internal {
        optimisticOracleV3 = OptimisticOracleV3Interface(
            finder.getImplementationAddress(OracleInterfaces.OptimisticOracleV3)
        );
    }
}
