// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../../common/implementation/FixedPoint.sol";
import "../../common/interfaces/JarvisExpandedIERC20.sol";
import "./PerpetualPositionManagerPoolPartyLib.sol";

import "../../oracle/interfaces/OracleInterface.sol";
import "../../oracle/interfaces/IdentifierWhitelistInterface.sol";
import "../../oracle/interfaces/AdministrateeInterface.sol";
import "../../oracle/implementation/Constants.sol";

import "../common/FeePayerPoolParty.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title Financial contract with priceless position management.
 * @notice Handles positions for multiple sponsors in an optimistic (i.e., priceless) way without relying
 * on a price feed. On construction, deploys a new ERC20, managed by this contract, that is the synthetic token.
 */

contract PerpetualPositionManagerPoolParty is AccessControl, FeePayerPoolParty {
    using FixedPoint for FixedPoint.Unsigned;
    using SafeERC20 for IERC20;
    using SafeERC20 for JarvisExpandedIERC20;
    using PerpetualPositionManagerPoolPartyLib for PositionData;
    using PerpetualPositionManagerPoolPartyLib for PositionManagerData;

    /****************************************
     *  COSTANTS  *
     ****************************************/

    bytes32 public constant TOKEN_SPONSOR_ROLE = keccak256("Token Sponsor");

    /****************************************
     *  PRICELESS POSITION DATA STRUCTURES  *
     ****************************************/

    //Describe role structure
    struct Roles {
        address[] admins;
        address[] tokenSponsors;
    }

    /**
     * @notice Construct the PerpetualPositionManager.
     * @dev Deployer of this contract should consider carefully which parties have ability to mint and burn
     * the synthetic tokens referenced by `_tokenAddress`. This contract's security assumes that no external accounts
     * can mint new tokens, which could be used to steal all of this contract's locked collateral.
     * We recommend to only use synthetic token contracts whose sole Owner role (the role capable of adding & removing roles)
     * is assigned to this contract, whose sole Minter role is assigned to this contract, and whose
     * total supply is 0 prior to construction of this contract.
     * @param _withdrawalLiveness liveness delay, in seconds, for pending withdrawals.
     * @param _collateralAddress ERC20 token used as collateral for all positions.
     * @param _tokenAddress ERC20 token used as synthetic token.
     * @param _finderAddress UMA protocol Finder used to discover other protocol contracts.
     * @param _priceIdentifier registered in the DVM for the synthetic.
     * @param _minSponsorTokens minimum amount of collateral that must exist at any time in a position.
     * @param _timerAddress Contract that stores the current time in a testing environment. Set to 0x0 for production.
     * @param _excessTokenBeneficiary Beneficiary to send all excess token balances that accrue in the contract.
     */
    struct PositionManagerParams {
        uint256 withdrawalLiveness;
        address collateralAddress;
        address tokenAddress;
        address finderAddress;
        bytes32 priceFeedIdentifier;
        FixedPoint.Unsigned minSponsorTokens;
        address timerAddress;
        address excessTokenBeneficiary;
    }

    // Represents a single sponsor's position. All collateral is held by this contract.
    // This struct acts as bookkeeping for how much of that collateral is allocated to each sponsor.
    struct PositionData {
        FixedPoint.Unsigned tokensOutstanding;
        // Tracks pending withdrawal requests. A withdrawal request is pending if `withdrawalRequestPassTimestamp != 0`.
        uint256 withdrawalRequestPassTimestamp;
        FixedPoint.Unsigned withdrawalRequestAmount;
        // Raw collateral value. This value should never be accessed directly -- always use _getFeeAdjustedCollateral().
        // To add or remove collateral, use _addCollateral() and _removeCollateral().
        FixedPoint.Unsigned rawCollateral;
    }

    // Maps sponsor addresses to their positions. Each sponsor can have only one position.

    struct GlobalPositionData {
        // Keep track of the total collateral and tokens across all positions to enable calculating the
        // global collateralization ratio without iterating over all positions.
        FixedPoint.Unsigned totalTokensOutstanding;
        // Similar to the rawCollateral in PositionData, this value should not be used directly.
        // _getFeeAdjustedCollateral(), _addCollateral() and _removeCollateral() must be used to access and adjust.
        FixedPoint.Unsigned rawTotalPositionCollateral;
    }

    struct PositionManagerData {
        // Synthetic token created by this contract.
        JarvisExpandedIERC20 tokenCurrency;
        // Unique identifier for DVM price feed ticker.
        bytes32 priceIdentifier;
        // Time that has to elapse for a withdrawal request to be considered passed, if no liquidations occur.
        // !!Note: The lower the withdrawal liveness value, the more risk incurred by the contract.
        //       Extremely low liveness values increase the chance that opportunistic invalid withdrawal requests
        //       expire without liquidation, thereby increasing the insolvency risk for the contract as a whole. An insolvent
        //       contract is extremely risky for any sponsor or synthetic token holder for the contract.
        uint256 withdrawalLiveness;
        // Minimum number of tokens in a sponsor's position.
        FixedPoint.Unsigned minSponsorTokens;
        // Expiry price pulled from the DVM in the case of an emergency shutdown.
        FixedPoint.Unsigned emergencyShutdownPrice;
        // Timestamp used in case of emergency shutdown.
        uint256 emergencyShutdownTimestamp;
        // The excessTokenBeneficiary of any excess tokens added to the contract.
        address excessTokenBeneficiary;
    }

    mapping(address => PositionData) public positions;

    GlobalPositionData public globalPositionData;

    PositionManagerData public positionManagerData;
    /****************************************
     *                EVENTS                *
     ****************************************/

    event Deposit(address indexed sponsor, uint256 indexed collateralAmount);
    event Withdrawal(address indexed sponsor, uint256 indexed collateralAmount);
    event RequestWithdrawal(address indexed sponsor, uint256 indexed collateralAmount);
    event RequestWithdrawalExecuted(address indexed sponsor, uint256 indexed collateralAmount);
    event RequestWithdrawalCanceled(address indexed sponsor, uint256 indexed collateralAmount);
    event PositionCreated(address indexed sponsor, uint256 indexed collateralAmount, uint256 indexed tokenAmount);
    event NewSponsor(address indexed sponsor);
    event EndedSponsorPosition(address indexed sponsor);
    event Redeem(address indexed sponsor, uint256 indexed collateralAmount, uint256 indexed tokenAmount);
    event Repay(address indexed sponsor, uint256 indexed numTokensRepaid, uint256 indexed newTokenCount);
    event EmergencyShutdown(address indexed caller, uint256 shutdownTimestamp);
    event SettleEmergencyShutdown(
        address indexed caller,
        uint256 indexed collateralReturned,
        uint256 indexed tokensBurned
    );

    /****************************************
     *               MODIFIERS              *
     ****************************************/

    modifier onlyTokenSponsor() {
        require(hasRole(TOKEN_SPONSOR_ROLE, msg.sender), "Sender must be the token sponsor");
        _;
    }

    modifier onlyCollateralizedPosition(address sponsor) {
        _onlyCollateralizedPosition(sponsor);
        _;
    }

    modifier notEmergencyShutdown() {
        _notEmergencyShutdown();
        _;
    }

    modifier isEmergencyShutdown() {
        _isEmergencyShutdown();
        _;
    }

    modifier noPendingWithdrawal(address sponsor) {
        _positionHasNoPendingWithdrawal(sponsor);
        _;
    }

    /**
     * @notice Construct the PerpetualPositionManager.
     * @param _positionManagerData Input parameters of PositionManager (see PositionManagerData struct)
     * @param _roles List of admin and token sponsors roles
     */

    constructor(PositionManagerParams memory _positionManagerData, Roles memory _roles)
        public
        FeePayerPoolParty(
            _positionManagerData.collateralAddress,
            _positionManagerData.finderAddress,
            _positionManagerData.timerAddress
        )
        nonReentrant()
    {
        require(
            _getIdentifierWhitelist().isIdentifierSupported(_positionManagerData.priceFeedIdentifier),
            "Unsupported price identifier"
        );
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(TOKEN_SPONSOR_ROLE, DEFAULT_ADMIN_ROLE);
        for (uint256 j = 0; j < _roles.admins.length; j++) {
            _setupRole(DEFAULT_ADMIN_ROLE, _roles.admins[j]);
        }
        if (_roles.tokenSponsors.length > 0) {
            for (uint256 j = 0; j < _roles.tokenSponsors.length; j++) {
                _setupRole(TOKEN_SPONSOR_ROLE, _roles.tokenSponsors[j]);
            }
        }
        positionManagerData.withdrawalLiveness = _positionManagerData.withdrawalLiveness;
        positionManagerData.tokenCurrency = JarvisExpandedIERC20(_positionManagerData.tokenAddress);
        positionManagerData.minSponsorTokens = _positionManagerData.minSponsorTokens;
        positionManagerData.priceIdentifier = _positionManagerData.priceFeedIdentifier;
        positionManagerData.excessTokenBeneficiary = _positionManagerData.excessTokenBeneficiary;
    }

    /****************************************
     *          POSITION FUNCTIONS          *
     ****************************************/

    /**
     * @notice Transfers `collateralAmount` of `feePayerData.collateralCurrency` into the specified sponsor's position.
     * @dev Increases the collateralization level of a position after creation. This contract must be approved to spend
     * at least `collateralAmount` of `feePayerData.collateralCurrency`.
     * @param sponsor the sponsor to credit the deposit to.
     * @param collateralAmount total amount of collateral tokens to be sent to the sponsor's position.
     */
    function depositTo(address sponsor, FixedPoint.Unsigned memory collateralAmount)
        public
        onlyTokenSponsor()
        notEmergencyShutdown()
        noPendingWithdrawal(sponsor)
        fees()
        nonReentrant()
    {
        PositionData storage positionData = _getPositionData(sponsor);

        positionData.depositTo(globalPositionData, collateralAmount, feePayerData, sponsor);
    }

    /**
     * @notice Transfers `collateralAmount` of `feePayerData.collateralCurrency` into the caller's position.
     * @dev Increases the collateralization level of a position after creation. This contract must be approved to spend
     * at least `collateralAmount` of `feePayerData.collateralCurrency`.
     * @param collateralAmount total amount of collateral tokens to be sent to the sponsor's position.
     */
    function deposit(FixedPoint.Unsigned memory collateralAmount) public {
        // This is just a thin wrapper over depositTo that specified the sender as the sponsor.
        depositTo(msg.sender, collateralAmount);
    }

    /**
     * @notice Transfers `collateralAmount` of `feePayerData.collateralCurrency` from the sponsor's position to the sponsor.
     * @dev Reverts if the withdrawal puts this position's collateralization ratio below the global collateralization
     * ratio. In that case, use `requestWithdrawal`. Might not withdraw the full requested amount to account for precision loss.
     * @param collateralAmount is the amount of collateral to withdraw.
     * @return amountWithdrawn The actual amount of collateral withdrawn.
     */
    function withdraw(FixedPoint.Unsigned memory collateralAmount)
        public
        onlyTokenSponsor()
        notEmergencyShutdown()
        noPendingWithdrawal(msg.sender)
        fees()
        nonReentrant()
        returns (FixedPoint.Unsigned memory amountWithdrawn)
    {
        PositionData storage positionData = _getPositionData(msg.sender);

        amountWithdrawn = positionData.withdraw(globalPositionData, collateralAmount, feePayerData);
    }

    /**
     * @notice Starts a withdrawal request that, if passed, allows the sponsor to withdraw` from their position.
     * @dev The request will be pending for `withdrawalLiveness`, during which the position can be liquidated.
     * @param collateralAmount the amount of collateral requested to withdraw
     */
    function requestWithdrawal(FixedPoint.Unsigned memory collateralAmount)
        public
        onlyTokenSponsor()
        notEmergencyShutdown()
        noPendingWithdrawal(msg.sender)
        nonReentrant()
    {
        uint256 actualTime = getCurrentTime();
        PositionData storage positionData = _getPositionData(msg.sender);
        positionData.requestWithdrawal(positionManagerData, collateralAmount, actualTime, feePayerData);
    }

    /**
     * @notice After a passed withdrawal request (i.e., by a call to `requestWithdrawal` and waiting
     * `withdrawalLiveness`), withdraws `positionData.withdrawalRequestAmount` of collateral currency.
     * @dev Might not withdraw the full requested amount in order to account for precision loss or if the full requested
     * amount exceeds the collateral in the position (due to paying fees).
     * @return amountWithdrawn The actual amount of collateral withdrawn.
     */
    function withdrawPassedRequest()
        external
        onlyTokenSponsor()
        notEmergencyShutdown()
        fees()
        nonReentrant()
        returns (FixedPoint.Unsigned memory amountWithdrawn)
    {
        uint256 actualTime = getCurrentTime();
        PositionData storage positionData = _getPositionData(msg.sender);
        amountWithdrawn = positionData.withdrawPassedRequest(globalPositionData, actualTime, feePayerData);
    }

    /**
     * @notice Cancels a pending withdrawal request.
     */
    function cancelWithdrawal() external onlyTokenSponsor() notEmergencyShutdown() nonReentrant() {
        PositionData storage positionData = _getPositionData(msg.sender);
        positionData.cancelWithdrawal();
    }

    /**
     * @notice Creates tokens by creating a new position or by augmenting an existing position. Pulls `collateralAmount
     * ` into the sponsor's position and mints `numTokens` of `tokenCurrency`.
     * @dev This contract must have the Minter role for the `tokenCurrency`.
     * @dev Reverts if minting these tokens would put the position's collateralization ratio below the
     * global collateralization ratio. This contract must be approved to spend at least `collateralAmount` of
     * `feePayerData.collateralCurrency`.
     * @param collateralAmount is the number of collateral tokens to collateralize the position with
     * @param numTokens is the number of tokens to mint from the position.
     */
    function create(FixedPoint.Unsigned memory collateralAmount, FixedPoint.Unsigned memory numTokens)
        public
        onlyTokenSponsor()
        notEmergencyShutdown()
        fees()
        nonReentrant()
    {
        PositionData storage positionData = positions[msg.sender];

        positionData.create(globalPositionData, positionManagerData, collateralAmount, numTokens, feePayerData);
    }

    /**
     * @notice Burns `numTokens` of `tokenCurrency` and sends back the proportional amount of `feePayerData.collateralCurrency`.
     * @dev Can only be called by a token sponsor. Might not redeem the full proportional amount of collateral
     * in order to account for precision loss. This contract must be approved to spend at least `numTokens` of
     * `tokenCurrency`.
     * @dev This contract must have the Burner role for the `tokenCurrency`.
     * @param numTokens is the number of tokens to be burnt for a commensurate amount of collateral.
     * @return amountWithdrawn The actual amount of collateral withdrawn.
     */
    function redeem(FixedPoint.Unsigned memory numTokens)
        public
        onlyTokenSponsor()
        notEmergencyShutdown()
        noPendingWithdrawal(msg.sender)
        fees()
        nonReentrant()
        returns (FixedPoint.Unsigned memory amountWithdrawn)
    {
        PositionData storage positionData = _getPositionData(msg.sender);

        amountWithdrawn = positionData.redeeem(
            globalPositionData,
            positionManagerData,
            numTokens,
            feePayerData,
            msg.sender
        );
    }

    /**
     * @notice Burns `numTokens` of `tokenCurrency` to decrease sponsors position size, without sending back `feePayerData.collateralCurrency`.
     * This is done by a sponsor to increase position CR. Resulting size is bounded by minSponsorTokens.
     * @dev Can only be called by token sponsor. This contract must be approved to spend `numTokens` of `tokenCurrency`.
     * @dev This contract must have the Burner role for the `tokenCurrency`.
     * @param numTokens is the number of tokens to be burnt for a commensurate amount of collateral.
     */
    function repay(FixedPoint.Unsigned memory numTokens)
        public
        onlyTokenSponsor()
        notEmergencyShutdown()
        noPendingWithdrawal(msg.sender)
        fees()
        nonReentrant()
    {
        PositionData storage positionData = _getPositionData(msg.sender);
        positionData.repay(globalPositionData, positionManagerData, numTokens);
    }

    /**
     * @notice If the contract is emergency shutdown then all token holders and sponsors can redeem their tokens or
     * remaining collateral for underlying at the prevailing price defined by a DVM vote.
     * @dev This burns all tokens from the caller of `tokenCurrency` and sends back the resolved settlement value of
     * `feePayerData.collateralCurrency`. Might not redeem the full proportional amount of collateral in order to account for
     * precision loss. This contract must be approved to spend `tokenCurrency` at least up to the caller's full balance.
     * @dev This contract must have the Burner role for the `tokenCurrency`.
     * @dev Note that this function does not call the updateFundingRate modifier to update the funding rate as this
     * function is only called after an emergency shutdown & there should be no funding rate updates after the shutdown.
     * @return amountWithdrawn The actual amount of collateral withdrawn.
     */
    function settleEmergencyShutdown()
        external
        onlyTokenSponsor()
        isEmergencyShutdown()
        fees()
        nonReentrant()
        returns (FixedPoint.Unsigned memory amountWithdrawn)
    {
        PositionData storage positionData = positions[msg.sender];
        amountWithdrawn = positionData.settleEmergencyShutdown(globalPositionData, positionManagerData, feePayerData);
    }

    /****************************************
     *        GLOBAL STATE FUNCTIONS        *
     ****************************************/

    /**
     * @notice Premature contract settlement under emergency circumstances.
     * @dev Only the governor can call this function as they are permissioned within the `FinancialContractAdmin`.
     * Upon emergency shutdown, the contract settlement time is set to the shutdown time. This enables withdrawal
     * to occur via the `settleEmergencyShutdown` function.
     */
    function emergencyShutdown() external override onlyTokenSponsor() notEmergencyShutdown() nonReentrant() {
        positionManagerData.emergencyShutdownTimestamp = getCurrentTime();
        positionManagerData.requestOraclePrice(positionManagerData.emergencyShutdownTimestamp, feePayerData);
        emit EmergencyShutdown(msg.sender, positionManagerData.emergencyShutdownTimestamp);
    }

    /**
     * @notice Theoretically supposed to pay fees and move money between margin accounts to make sure they
     * reflect the NAV of the contract. However, this functionality doesn't apply to this contract.
     * @dev This is supposed to be implemented by any contract that inherits `AdministrateeInterface` and callable
     * only by the Governor contract. This method is therefore minimally implemented in this contract and does nothing.
     */
    function remargin() external override {
        return;
    }

    /**
     * @notice Drains any excess balance of the provided ERC20 token to a pre-selected beneficiary.
     * @dev This will drain down to the amount of tracked collateral and drain the full balance of any other token.
     * @param token address of the ERC20 token whose excess balance should be drained.
     */
    function trimExcess(IERC20 token) external nonReentrant() returns (FixedPoint.Unsigned memory amount) {
        FixedPoint.Unsigned memory pfcAmount = _pfc();
        amount = positionManagerData.trimExcess(token, pfcAmount, feePayerData);
    }

    /**
     * @notice Delete liquidation of a TokenSponsor psoition (This function can only be called by the contract itself)
     * @param sponsor address of the TokenSponsor.
     */
    function deleteSponsorPosition(address sponsor) external onlyThisContract {
        delete positions[sponsor];
    }

    /**
     * @notice Add TokenSponsor to TOKEN_SPONSOR_ROLE
     * @param sponsor address of the TokenSponsor.
     */
    function addTokenSponsor(address sponsor) external {
        grantRole(TOKEN_SPONSOR_ROLE, sponsor);
    }

    /**
     * @notice Add admin to DEFAULT_ADMIN_ROLE
     * @param admin address of the TokenSponsor.
     */
    function addAdmin(address admin) external {
        grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Add admin and TokenSponsor to DEFAULT_ADMIN_ROLE and TOKEN_SPONSOR_ROLE
     * @param adminAndSponsor address of admin/TokenSponsor.
     */
    function addAdminAndTokenSponsor(address adminAndSponsor) external {
        grantRole(DEFAULT_ADMIN_ROLE, adminAndSponsor);
        grantRole(TOKEN_SPONSOR_ROLE, adminAndSponsor);
    }

    /**
     * @notice TokenSponsor renounce to TOKEN_SPONSOR_ROLE
     */
    function renounceTokenSponsor() external {
        renounceRole(TOKEN_SPONSOR_ROLE, msg.sender);
    }

    /**
     * @notice Admin renounce to DEFAULT_ADMIN_ROLE
     */
    function renounceAdmin() external {
        renounceRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Admin and TokenSponsor renounce to DEFAULT_ADMIN_ROLE and TOKEN_SPONSOR_ROLE
     */
    function renounceAdminAndTokenSponsor() external {
        renounceRole(DEFAULT_ADMIN_ROLE, msg.sender);
        renounceRole(TOKEN_SPONSOR_ROLE, msg.sender);
    }

    /**
     * @notice Add derivative as minter of synthetic token
     * @param derivative address of the derivative
     */
    function addSyntheticTokenMinter(address derivative) external onlyTokenSponsor() {
        positionManagerData.tokenCurrency.addMinter(derivative);
    }

    /**
     * @notice Add derivative as burner of synthetic token
     * @param derivative address of the derivative
     */
    function addSyntheticTokenBurner(address derivative) external onlyTokenSponsor() {
        positionManagerData.tokenCurrency.addBurner(derivative);
    }

    /**
     * @notice Add derivative as admin of synthetic token
     * @param derivative address of the derivative
     */
    function addSyntheticTokenAdmin(address derivative) external onlyTokenSponsor() {
        positionManagerData.tokenCurrency.addAdmin(derivative);
    }

    /**
     * @notice Add derivative as admin, minter and burner of synthetic token
     * @param derivative address of the derivative
     */
    function addSyntheticTokenAdminAndMinterAndBurner(address derivative) external onlyTokenSponsor() {
        positionManagerData.tokenCurrency.addAdminAndMinterAndBurner(derivative);
    }

    /**
     * @notice This contract renounce to be minter of synthetic token
     */
    function renounceSyntheticTokenMinter() external onlyTokenSponsor() {
        positionManagerData.tokenCurrency.renounceMinter();
    }

    /**
     * @notice This contract renounce to be burner of synthetic token
     */
    function renounceSyntheticTokenBurner() external onlyTokenSponsor() {
        positionManagerData.tokenCurrency.renounceBurner();
    }

    /**
     * @notice This contract renounce to be admin of synthetic token
     */
    function renounceSyntheticTokenAdmin() external onlyTokenSponsor() {
        positionManagerData.tokenCurrency.renounceAdmin();
    }

    /**
     * @notice This contract renounce to be admin, minter and burner of synthetic token
     */
    function renounceSyntheticTokenAdminAndMinterAndBurner() external onlyTokenSponsor() {
        positionManagerData.tokenCurrency.renounceAdminAndMinterAndBurner();
    }

    /**
     * @notice Accessor method for a sponsor's collateral.
     * @dev This is necessary because the struct returned by the positions() method shows
     * rawCollateral, which isn't a user-readable value.
     * @param sponsor address whose collateral amount is retrieved.
     * @return collateralAmount amount of collateral within a sponsors position.
     */
    function getCollateral(address sponsor)
        external
        view
        nonReentrantView()
        returns (FixedPoint.Unsigned memory collateralAmount)
    {
        // Note: do a direct access to avoid the validity check.
        return positions[sponsor].rawCollateral.getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier);
    }

    /**
     * @notice Accessor method for the total collateral stored within the PerpetualPositionManager.
     * @return totalCollateral amount of all collateral within the position manager.
     */
    function totalPositionCollateral()
        external
        view
        nonReentrantView()
        returns (FixedPoint.Unsigned memory totalCollateral)
    {
        return
            globalPositionData.rawTotalPositionCollateral.getFeeAdjustedCollateral(
                feePayerData.cumulativeFeeMultiplier
            );
    }

    /**
     * @notice Accessor method for the list of member with admin role
     * @return array of address with admin role
     */

    function getAdminMembers() external view returns (address[] memory) {
        uint256 numberOfMembers = getRoleMemberCount(DEFAULT_ADMIN_ROLE);
        address[] memory members = new address[](numberOfMembers);
        for (uint256 j = 0; j < numberOfMembers; j++) {
            address newMember = getRoleMember(DEFAULT_ADMIN_ROLE, j);
            members[j] = newMember;
        }
        return members;
    }

    /**
     * @notice Accessor method for the list of member with tokenSponsor role
     * @return array of address with tokenSponsor role
     */

    function getTokenSponsorMembers() external view returns (address[] memory) {
        uint256 numberOfMembers = getRoleMemberCount(TOKEN_SPONSOR_ROLE);
        address[] memory members = new address[](numberOfMembers);
        for (uint256 j = 0; j < numberOfMembers; j++) {
            address newMember = getRoleMember(TOKEN_SPONSOR_ROLE, j);
            members[j] = newMember;
        }
        return members;
    }

    /****************************************
     *          INTERNAL FUNCTIONS          *
     ****************************************/

    function _pfc() internal view virtual override returns (FixedPoint.Unsigned memory) {
        return
            globalPositionData.rawTotalPositionCollateral.getFeeAdjustedCollateral(
                feePayerData.cumulativeFeeMultiplier
            );
    }

    function _getPositionData(address sponsor)
        internal
        view
        onlyCollateralizedPosition(sponsor)
        returns (PositionData storage)
    {
        return positions[sponsor];
    }

    function _getIdentifierWhitelist() internal view returns (IdentifierWhitelistInterface) {
        return
            IdentifierWhitelistInterface(
                feePayerData.finder.getImplementationAddress(OracleInterfaces.IdentifierWhitelist)
            );
    }

    // Fetches a resolved Oracle price from the Oracle. Reverts if the Oracle hasn't resolved for this request.

    // These internal functions are supposed to act identically to modifiers, but re-used modifiers
    // unnecessarily increase contract bytecode size.
    // source: https://blog.polymath.network/solidity-tips-and-tricks-to-save-gas-and-reduce-bytecode-size-c44580b218e6
    function _onlyCollateralizedPosition(address sponsor) internal view {
        require(
            positions[sponsor]
                .rawCollateral
                .getFeeAdjustedCollateral(feePayerData.cumulativeFeeMultiplier)
                .isGreaterThan(0),
            "Position has no collateral"
        );
    }

    function _notEmergencyShutdown() internal view {
        require(positionManagerData.emergencyShutdownTimestamp == 0, "Contract emergency shutdown");
    }

    function _isEmergencyShutdown() internal view {
        require(positionManagerData.emergencyShutdownTimestamp != 0, "Contract not emergency shutdown");
    }

    // Note: This checks whether an already existing position has a pending withdrawal. This cannot be used on the
    // `create` method because it is possible that `create` is called on a new position (i.e. one without any collateral
    // or tokens outstanding) which would fail the `onlyCollateralizedPosition` modifier on `_getPositionData`.
    function _positionHasNoPendingWithdrawal(address sponsor) internal view {
        require(_getPositionData(sponsor).withdrawalRequestPassTimestamp == 0, "Pending withdrawal");
    }
}
