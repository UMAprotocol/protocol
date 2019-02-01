/*
  Tokenized Derivative implementation

  Implements a simplified version of tokenized Product/ETH Products.
*/
pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "./AdminInterface.sol";
import "./ContractCreator.sol";
import "./OracleInterface.sol";
import "./PriceFeedInterface.sol";
import "./ReturnCalculatorInterface.sol";
import "./StoreInterface.sol";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/drafts/SignedSafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


library TokenizedDerivativeParams {
    struct ConstructorParams {
        address sponsor;
        address admin;
        address oracle;
        address store;
        address priceFeed;
        uint  defaultPenalty; // Percentage of nav * 10^18
        uint requiredMargin; // Percentage of nav * 10^18
        bytes32 product;
        uint fixedYearlyFee; // Percentage of nav * 10^18
        uint  disputeDeposit; // Percentage of nav * 10^18
        address returnCalculator;
        uint startingTokenPrice;
        uint expiry;
        address marginCurrency;
        uint  withdrawLimit; // Percentage of derivativeStorage.shortBalance * 10^18
    }
}


// TODO(mrice32): make this and TotalReturnSwap derived classes of a single base to encap common functionality.
contract TokenizedDerivative is ERC20, AdminInterface {
    using SafeMath for uint;
    using SignedSafeMath for int;

    // Note: these variables are to give ERC20 consumers information about the token.
    string public name;
    string public symbol;
    uint8 public constant decimals = 18; // solhint-disable-line const-name-snakecase
    uint private constant SECONDS_PER_YEAR = 31536000;
    uint private constant SECONDS_PER_DAY = 86400;

    enum State {
        // The contract is active, and tokens can be created and redeemed. Margin can be added and withdrawn (as long as
        // it exceeds required levels). Remargining is allowed. Created contracts immediately begin in this state.
        // Possible state transitions: Disputed, Expired, Defaulted.
        Live,

        // Disputed, Expired, Defaulted, and Emergency are Frozen states. In a Frozen state, the contract is frozen in
        // time awaiting a resolution by the Oracle. No tokens can be created or redeemed. Margin cannot be withdrawn.
        // The resolution of these states moves the contract to the Settled state. Remargining is not allowed.

        // The derivativeStorage.externalAddresses.sponsor has disputed the price feed output. If the dispute is valid (i.e., the NAV calculated from the
        // Oracle price differs from the NAV calculated from the price feed), the dispute fee is added to the short
        // account. Otherwise, the dispute fee is added to the long margin account.
        // Possible state transitions: Settled.
        Disputed,

        // Contract expiration has been reached.
        // Possible state transitions: Settled.
        Expired,

        // The short margin account is below its margin requirement. The derivativeStorage.externalAddresses.sponsor can choose to confirm the default and
        // move to Settle without waiting for the Oracle. Default penalties will be assessed when the contract moves to
        // Settled.
        // Possible state transitions: Settled.
        Defaulted,

        // UMA has manually triggered a shutdown of the account.
        // Possible state transitions: Settled.
        Emergency,

        // Token price is fixed. Tokens can be redeemed by anyone. All short margin can be withdrawn. Tokens can't be
        // created, and contract can't remargin.
        // Possible state transitions: None.
        Settled
    }

    // The state of the token at a particular time. The state gets updated on remargin.
    struct TokenState {
        int underlyingPrice;
        int tokenPrice;
        uint time;
    }

    // The information in the following struct is only valid if in the midst of a Dispute.
    struct Dispute {
        int disputedNav;
        uint deposit;
    }

    struct WithdrawThrottle {
        uint startTime;
        uint remainingWithdrawal;
    }

    struct FixedParameters {
        // Fixed contract parameters.
        uint defaultPenalty; // Percentage of nav*10^18
        uint marginRequirement; // Percentage of nav*10^18
        uint disputeDeposit; // Percentage of nav*10^18
        uint fixedFeePerSecond; // Percentage of nav*10^18
        uint withdrawLimit; // Percentage of derivativeStorage.shortBalance*10^18
        bytes32 product;
    }

    struct ExternalAddresses {
        // Other addresses/contracts
        address sponsor;
        address admin;
        address apDelegate;
        OracleInterface oracle;
        StoreInterface store;
        PriceFeedInterface priceFeed;
        ReturnCalculatorInterface returnCalculator;
        IERC20 marginCurrency;
    }

    struct Storage {
        FixedParameters fixedParameters;
        ExternalAddresses externalAddresses;

        // Balances
        int shortBalance;
        int longBalance;

        State state;
        uint endTime;

        // The NAV of the contract always reflects the transition from (`prev`, `current`).
        // In the case of a remargin, a `latest` price is retrieved from the price feed, and we shift `current` -> `prev`
        // and `latest` -> `current` (and then recompute).
        // In the case of a dispute, `current` might change (which is why we have to hold on to `prev`).
        TokenState prevTokenState;
        TokenState currentTokenState;

        int nav;  // Net asset value is measured in Wei

        Dispute disputeInfo;

        // Only valid if in the midst of a Default.
        int navAtDefault;

        WithdrawThrottle withdrawThrottle;
    }

    Storage public derivativeStorage;

    modifier onlySponsor {
        require(msg.sender == derivativeStorage.externalAddresses.sponsor);
        _;
    }

    modifier onlyAdmin {
        require(msg.sender == derivativeStorage.externalAddresses.admin);
        _;
    }

    modifier onlySponsorOrAdmin {
        require(msg.sender == derivativeStorage.externalAddresses.sponsor || msg.sender == derivativeStorage.externalAddresses.admin);
        _;
    }

    modifier onlySponsorOrApDelegate {
        require(msg.sender == derivativeStorage.externalAddresses.sponsor || msg.sender == derivativeStorage.externalAddresses.apDelegate);
        _;
    }

    // TODO(ptare): Adding name and symbol to ConstructorParams causes the transaction to always revert without a useful
    // error message. Need to investigate this issue more.
    constructor(
        TokenizedDerivativeParams.ConstructorParams memory params,
        string memory _name,
        string memory _symbol
    ) public payable {
        // The default penalty must be less than the required margin, which must be less than the NAV.
        require(params.defaultPenalty <= params.requiredMargin);
        require(params.requiredMargin <= 1 ether);
        derivativeStorage.fixedParameters.marginRequirement = params.requiredMargin;

        derivativeStorage.externalAddresses.marginCurrency = IERC20(params.marginCurrency);
        
        // Keep the starting token price relatively close to 1 ether to prevent users from unintentionally creating
        // rounding or overflow errors.
        require(params.startingTokenPrice >= uint(1 ether).div(10**9));
        require(params.startingTokenPrice <= uint(1 ether).mul(10**9));

        // Address information
        derivativeStorage.externalAddresses.oracle = OracleInterface(params.oracle);
        derivativeStorage.externalAddresses.store = StoreInterface(params.store);
        derivativeStorage.externalAddresses.priceFeed = PriceFeedInterface(params.priceFeed);
        // Verify that the price feed and derivativeStorage.externalAddresses.oracle support the given derivativeStorage.fixedParameters.product.
        require(derivativeStorage.externalAddresses.oracle.isIdentifierSupported(params.product));
        require(derivativeStorage.externalAddresses.priceFeed.isIdentifierSupported(params.product));

        derivativeStorage.externalAddresses.sponsor = params.sponsor;
        derivativeStorage.externalAddresses.admin = params.admin;
        derivativeStorage.externalAddresses.returnCalculator = ReturnCalculatorInterface(params.returnCalculator);

        // Contract parameters.
        derivativeStorage.fixedParameters.defaultPenalty = params.defaultPenalty;
        derivativeStorage.fixedParameters.product = params.product;
        derivativeStorage.fixedParameters.fixedFeePerSecond = params.fixedYearlyFee.div(SECONDS_PER_YEAR);
        derivativeStorage.fixedParameters.disputeDeposit = params.disputeDeposit;
        name = _name;
        symbol = _symbol;

        // TODO(mrice32): we should have an ideal start time rather than blindly polling.
        (uint latestTime, int latestUnderlyingPrice) = derivativeStorage.externalAddresses.priceFeed.latestPrice(derivativeStorage.fixedParameters.product);
        require(latestTime != 0);

        // Set end time to max value of uint to implement no expiry.
        if (params.expiry == 0) {
            derivativeStorage.endTime = ~uint(0);
        } else {
            require(params.expiry >= latestTime);
            derivativeStorage.endTime = params.expiry;
        }

        derivativeStorage.nav = _computeInitialNav(latestUnderlyingPrice, latestTime, params.startingTokenPrice);

        derivativeStorage.state = State.Live;

        require(params.withdrawLimit < 1 ether);
        derivativeStorage.fixedParameters.withdrawLimit = params.withdrawLimit;
    }

    function createTokens() external payable onlySponsorOrApDelegate {
        _createTokens(_pullSentMargin());
    }

    function depositAndCreateTokens(uint newTokenNav) external payable onlySponsorOrApDelegate {
        // Subtract newTokenNav from amount sent.
        uint sentAmount = _pullSentMargin();
        uint depositAmount = sentAmount.sub(newTokenNav);

        // Deposit additional margin into the short account.
        _deposit(depositAmount);

        // Create new newTokenNav worth of tokens.
        _createTokens(newTokenNav);
    }

    function redeemTokens() external {
        require(derivativeStorage.state == State.Live || derivativeStorage.state == State.Settled);

        if (derivativeStorage.state == State.Live) {
            require(msg.sender == derivativeStorage.externalAddresses.sponsor || msg.sender == derivativeStorage.externalAddresses.apDelegate);
            _remargin();
        }

        uint initialSupply = totalSupply();

        uint numTokens = _pullAllAuthorizedTokens(this);
        require(numTokens > 0);
        _burn(address(this), numTokens);

        // Value of the tokens is just the percentage of all the tokens multiplied by the balance of the investor
        // margin account.
        assert(derivativeStorage.longBalance >= 0);
        uint tokenPercentage = numTokens.mul(1 ether).div(initialSupply);
        uint tokenValue = _takePercentage(uint(derivativeStorage.longBalance), tokenPercentage);

        derivativeStorage.longBalance = derivativeStorage.longBalance.sub(int(tokenValue));
        derivativeStorage.nav = _computeNavFromTokenPrice(derivativeStorage.currentTokenState.tokenPrice);

        _sendMargin(tokenValue);
    }

    function dispute() external payable onlySponsor {
        require(
            derivativeStorage.state == State.Live,
            "Contract must be Live to dispute"
        );

        uint requiredDeposit = uint(_takePercentage(derivativeStorage.nav, derivativeStorage.fixedParameters.disputeDeposit));

        uint sentAmount = _pullSentMargin();

        require(sentAmount >= requiredDeposit);
        uint refund = sentAmount.sub(requiredDeposit);

        derivativeStorage.state = State.Disputed;
        derivativeStorage.endTime = derivativeStorage.currentTokenState.time;
        derivativeStorage.disputeInfo.disputedNav = derivativeStorage.nav;
        derivativeStorage.disputeInfo.deposit = requiredDeposit;

        _requestOraclePrice(derivativeStorage.endTime);

        _sendMargin(refund);
    }

    function withdraw(uint amount) external onlySponsor {
        // Remargin before allowing a withdrawal, but only if in the live state.
        if (derivativeStorage.state == State.Live) {
            _remargin();
        }

        // Make sure either in Live or Settled after any necessary remargin.
        require(derivativeStorage.state == State.Live || derivativeStorage.state == State.Settled);

        // If the contract has been settled or is in prefunded state then can
        // withdraw up to full balance. If the contract is in live state then
        // must leave at least `requiredMargin`. Not allowed to withdraw in
        // other states.
        int withdrawableAmount;
        if (derivativeStorage.state == State.Settled) {
            withdrawableAmount = derivativeStorage.shortBalance;
        } else {
            // Update throttling snapshot and verify that this withdrawal doesn't go past the throttle limit.
            uint currentTime = derivativeStorage.currentTokenState.time;
            if (derivativeStorage.withdrawThrottle.startTime <= currentTime.sub(SECONDS_PER_DAY)) {
                // We've passed the previous derivativeStorage.withdrawThrottle window. Start new one.
                derivativeStorage.withdrawThrottle.startTime = currentTime;
                derivativeStorage.withdrawThrottle.remainingWithdrawal = _takePercentage(uint(derivativeStorage.shortBalance), derivativeStorage.fixedParameters.withdrawLimit);
            }

            int marginMaxWithdraw = derivativeStorage.shortBalance.sub(_getRequiredEthMargin(derivativeStorage.nav));
            int throttleMaxWithdraw = int(derivativeStorage.withdrawThrottle.remainingWithdrawal);

            // Take the smallest of the two withdrawal limits.
            withdrawableAmount = throttleMaxWithdraw < marginMaxWithdraw ? throttleMaxWithdraw : marginMaxWithdraw;

            // Note: this line alone implicitly ensures the withdrawal throttle is not violated, but the above
            // ternary is more explicit.
            derivativeStorage.withdrawThrottle.remainingWithdrawal = derivativeStorage.withdrawThrottle.remainingWithdrawal.sub(amount);
        }

        // Can only withdraw the allowed amount.
        require(
            withdrawableAmount >= int(amount),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return.
        derivativeStorage.shortBalance = derivativeStorage.shortBalance.sub(int(amount));
        _sendMargin(amount);
    }

    function remargin() external onlySponsorOrAdmin {
        _remargin();
    }

    function confirmPrice() external onlySponsor {
        // Right now, only confirming prices in the defaulted state.
        require(derivativeStorage.state == State.Defaulted);

        // Remargin on agreed upon price.
        _settleAgreedPrice();
    }

    function setApDelegate(address _apDelegate) external onlySponsor {
        derivativeStorage.externalAddresses.apDelegate = _apDelegate;
    }

    // Moves the contract into the Emergency state, where it waits on an Oracle price for the most recent remargin time.
    function emergencyShutdown() external onlyAdmin {
        require(derivativeStorage.state == State.Live);
        derivativeStorage.state = State.Emergency;
        derivativeStorage.endTime = derivativeStorage.currentTokenState.time;
        _requestOraclePrice(derivativeStorage.endTime);
    }

    // Returns the expected net asset value (NAV) of the contract using the latest available Price Feed price.
    function calcNAV() external view returns (int navNew) {
        (uint latestTime, int latestUnderlyingPrice) = _getLatestPrice();
        require(latestTime < derivativeStorage.endTime);

        TokenState memory predictedTokenState = _computeNewTokenState(
            derivativeStorage.currentTokenState, latestUnderlyingPrice, latestTime);
        navNew = _computeNavFromTokenPrice(predictedTokenState.tokenPrice);
    }

    // Returns the expected value of each the outstanding tokens of the contract using the latest available Price Feed
    // price.
    function calcTokenValue() external view returns (int newTokenValue) {
        (uint latestTime, int latestUnderlyingPrice) = _getLatestPrice();
        require(latestTime < derivativeStorage.endTime);

        TokenState memory predictedTokenState = _computeNewTokenState(
            derivativeStorage.currentTokenState, latestUnderlyingPrice, latestTime);
        newTokenValue = predictedTokenState.tokenPrice;
    }

    // Returns the expected balance of the short margin account using the latest available Price Feed price.
    function calcShortMarginBalance() external view returns (int newShortMarginBalance) {
        (uint latestTime, int latestUnderlyingPrice) = _getLatestPrice();
        require(latestTime < derivativeStorage.endTime);

        TokenState memory predictedTokenState = _computeNewTokenState(
            derivativeStorage.currentTokenState, latestUnderlyingPrice, latestTime);
        int navNew = _computeNavFromTokenPrice(predictedTokenState.tokenPrice);
        int longDiff = _getLongNavDiff(navNew);

        uint feeAmount = _computeExpectedOracleFees(derivativeStorage.currentTokenState.time, latestTime, derivativeStorage.nav);

        newShortMarginBalance = derivativeStorage.shortBalance.sub(longDiff).sub(int(feeAmount));
    }

    function settle() public {
        State startingState = derivativeStorage.state;
        require(startingState == State.Disputed || startingState == State.Expired
                || startingState == State.Defaulted || startingState == State.Emergency);
        _settleVerifiedPrice();
        if (startingState == State.Disputed) {
            int depositValue = int(derivativeStorage.disputeInfo.deposit);
            if (derivativeStorage.nav != derivativeStorage.disputeInfo.disputedNav) {
                derivativeStorage.shortBalance = derivativeStorage.shortBalance.add(depositValue);
            } else {
                derivativeStorage.longBalance = derivativeStorage.longBalance.add(depositValue);
            }
        }
    }

    function deposit() public payable onlySponsor {
        // Only allow the derivativeStorage.externalAddresses.sponsor to deposit margin.
        _deposit(_pullSentMargin());
    }

    // Deducts the fees from the margin account.
    function _deductOracleFees(uint lastTimeOracleFeesPaid, uint currentTime, int lastTokenNav) private returns (uint feeAmount) {
        feeAmount = _computeExpectedOracleFees(lastTimeOracleFeesPaid, currentTime, lastTokenNav);
        derivativeStorage.shortBalance = derivativeStorage.shortBalance.sub(int(feeAmount));
        // If paying the Oracle fee reduces the held margin below requirements, the rest of remargin() will default the
        // contract.
    }

    // Pays out the fees to the Oracle.
    function _payOracleFees(uint feeAmount) private {
        if (feeAmount == 0) {
            return;
        }

        if (address(derivativeStorage.externalAddresses.marginCurrency) == address(0x0)) {
            derivativeStorage.externalAddresses.store.payOracleFees.value(feeAmount)();
        } else {
            require(derivativeStorage.externalAddresses.marginCurrency.approve(address(derivativeStorage.externalAddresses.store), feeAmount));
            derivativeStorage.externalAddresses.store.payOracleFeesErc20(address(derivativeStorage.externalAddresses.marginCurrency));
        }
    }

    function _computeExpectedOracleFees(uint lastTimeOracleFeesPaid, uint currentTime, int lastTokenNav)
        private
        view
        returns (uint feeAmount)
    {
        uint expectedFeeAmount = derivativeStorage.externalAddresses.store.computeOracleFees(lastTimeOracleFeesPaid, currentTime, uint(lastTokenNav));
        return (uint(derivativeStorage.shortBalance) < expectedFeeAmount) ? uint(derivativeStorage.shortBalance) : expectedFeeAmount;
    }

    function _createTokens(uint navToPurchase) private {
        _remargin();

        // Verify that remargining didn't push the contract into expiry or default.
        require(derivativeStorage.state == State.Live);

        derivativeStorage.longBalance = derivativeStorage.longBalance.add(int(navToPurchase));

        _mint(msg.sender, uint(_tokensFromNav(int(navToPurchase), derivativeStorage.currentTokenState.tokenPrice)));

        derivativeStorage.nav = _computeNavFromTokenPrice(derivativeStorage.currentTokenState.tokenPrice);

        // Make sure this still satisfies the margin requirement.
        require(_satisfiesMarginRequirement(derivativeStorage.shortBalance, derivativeStorage.nav));
    }

    function _deposit(uint value) private {
        // Make sure that we are in a "depositable" state.
        require(derivativeStorage.state == State.Live);
        derivativeStorage.shortBalance = derivativeStorage.shortBalance.add(int(value));
    }

    function _pullSentMargin() private returns (uint amount) {
        if (address(derivativeStorage.externalAddresses.marginCurrency) == address(0x0)) {
            return msg.value;
        } else {
            // If we expect an ERC20 token, no ETH should be sent.
            require(msg.value == 0);
            return _pullAllAuthorizedTokens(derivativeStorage.externalAddresses.marginCurrency);
        }
    }

    function _sendMargin(uint amount) private {
        if (address(derivativeStorage.externalAddresses.marginCurrency) == address(0x0)) {
            msg.sender.transfer(amount);
        } else {
            require(derivativeStorage.externalAddresses.marginCurrency.transfer(msg.sender, amount));
        }
    }

    function _getRequiredEthMargin(int currentNav)
        private
        view
        returns (int requiredEthMargin)
    {
        return _takePercentage(currentNav, derivativeStorage.fixedParameters.marginRequirement);
    }

    // Function is internally only called by `_settleAgreedPrice` or `_settleVerifiedPrice`. This function handles all 
    // of the settlement logic including assessing penalties and then moves the state to `Settled`.
    function _settle(int price) private {

        // Remargin at whatever price we're using (verified or unverified).
        _updateBalances(_recomputeNav(price, derivativeStorage.endTime));

        bool inDefault = !_satisfiesMarginRequirement(derivativeStorage.shortBalance, derivativeStorage.nav);

        if (inDefault) {
            int expectedDefaultPenalty = _getDefaultPenaltyEth();
            int penalty = (derivativeStorage.shortBalance < expectedDefaultPenalty) ?
                derivativeStorage.shortBalance :
                expectedDefaultPenalty;

            derivativeStorage.shortBalance = derivativeStorage.shortBalance.sub(penalty);
            derivativeStorage.longBalance = derivativeStorage.longBalance.add(penalty);
        }

        derivativeStorage.state = State.Settled;
    }

    function _settleAgreedPrice() private {
        int agreedPrice = derivativeStorage.currentTokenState.underlyingPrice;

        _settle(agreedPrice);
    }

    function _settleVerifiedPrice() private {
        int oraclePrice = derivativeStorage.externalAddresses.oracle.getPrice(derivativeStorage.fixedParameters.product, derivativeStorage.endTime);
        _settle(oraclePrice);
    }

    // _remargin() allows other functions to call remargin internally without satisfying permission checks for
    // remargin().
    function _remargin() private {
        // If the state is not live, remargining does not make sense.
        require(derivativeStorage.state == State.Live);

        (uint latestTime, int latestPrice) = _getLatestPrice();
        // Checks whether contract has ended.
        if (latestTime <= derivativeStorage.currentTokenState.time) {
            // If the price feed hasn't advanced, remargining should be a no-op.
            return;
        }
        if (latestTime >= derivativeStorage.endTime) {
            derivativeStorage.state = State.Expired;
            derivativeStorage.prevTokenState = derivativeStorage.currentTokenState;
            uint feeAmount = _deductOracleFees(derivativeStorage.currentTokenState.time, derivativeStorage.endTime, derivativeStorage.nav);

            // We have no idea what the price was, exactly at derivativeStorage.endTime, so we can't set
            // derivativeStorage.currentTokenState, or update the nav, or do anything.
            _requestOraclePrice(derivativeStorage.endTime);
            _payOracleFees(feeAmount);
            return;
        }
        uint feeAmount = _deductOracleFees(derivativeStorage.currentTokenState.time, latestTime, derivativeStorage.nav);

        // Update nav of contract.
        int navNew = _computeNav(latestPrice, latestTime);
        
        // Save the current NAV in case it's required to compute the default penalty.
        int previousNav = derivativeStorage.nav;

        // Update the balances of the contract.
        _updateBalances(navNew);

        // Make sure contract has not moved into default.
        bool inDefault = !_satisfiesMarginRequirement(derivativeStorage.shortBalance, derivativeStorage.nav);
        if (inDefault) {
            derivativeStorage.state = State.Defaulted;
            derivativeStorage.navAtDefault = previousNav;
            derivativeStorage.endTime = latestTime; // Change end time to moment when default occurred.
        }

        if (inDefault) {
            _requestOraclePrice(derivativeStorage.endTime);
        }

        _payOracleFees(feeAmount);
    }

    function _updateBalances(int navNew) private {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update nav state variable.
        int longDiff = _getLongNavDiff(navNew);
        derivativeStorage.nav = navNew;

        derivativeStorage.longBalance = derivativeStorage.longBalance.add(longDiff);
        derivativeStorage.shortBalance = derivativeStorage.shortBalance.sub(longDiff);
    }

    function _satisfiesMarginRequirement(int balance, int currentNav)
        private
        view
        returns (bool doesSatisfyRequirement) 
    {
        return _getRequiredEthMargin(currentNav) <= balance;
    }

    // Gets the change in balance for the long side.
    // Note: there's a function for this because signage is tricky here, and it must be done the same everywhere.
    function _getLongNavDiff(int navNew) private view returns (int longNavDiff) {
        return navNew.sub(derivativeStorage.nav);
    }

    function _getDefaultPenaltyEth() private view returns (int penalty) {
        return _takePercentage(derivativeStorage.navAtDefault, derivativeStorage.fixedParameters.defaultPenalty);
    }

    function _tokensFromNav(int currentNav, int unitNav) private pure returns (int numTokens) {
        if (unitNav <= 0) {
            return 0;
        } else {
            return currentNav.mul(1 ether).div(unitNav);
        }
    }

    function _getLatestPrice() private view returns (uint latestTime, int latestUnderlyingPrice) {
        // If not live, then we should be using the Oracle not the price feed.
        require(derivativeStorage.state == State.Live);

        (latestTime, latestUnderlyingPrice) = derivativeStorage.externalAddresses.priceFeed.latestPrice(derivativeStorage.fixedParameters.product);
        require(latestTime != 0);
    }

    function _computeNav(int latestUnderlyingPrice, uint latestTime) private returns (int navNew) {
        derivativeStorage.prevTokenState = derivativeStorage.currentTokenState;
        derivativeStorage.currentTokenState = _computeNewTokenState(derivativeStorage.currentTokenState, latestUnderlyingPrice, latestTime);
        navNew = _computeNavFromTokenPrice(derivativeStorage.currentTokenState.tokenPrice);
    }

    function _recomputeNav(int oraclePrice, uint recomputeTime) private returns (int navNew) {
        // We're updating `last` based on what the Oracle has told us.
        // TODO(ptare): Add ability for the Oracle to correct the time as well.
        assert(derivativeStorage.endTime == recomputeTime);
        derivativeStorage.currentTokenState = _computeNewTokenState(derivativeStorage.prevTokenState, oraclePrice, recomputeTime);
        navNew = _computeNavFromTokenPrice(derivativeStorage.currentTokenState.tokenPrice);
    }

    function _computeInitialNav(int latestUnderlyingPrice, uint latestTime, uint startingTokenPrice)
        private
        returns (int navNew) {
            int unitNav = int(startingTokenPrice);
            derivativeStorage.prevTokenState = TokenState(latestUnderlyingPrice, unitNav, latestTime);
            derivativeStorage.currentTokenState = TokenState(latestUnderlyingPrice, unitNav, latestTime);
            navNew = _computeNavFromTokenPrice(unitNav);
        }

    function _requestOraclePrice(uint requestedTime) private {
        uint expectedTime = derivativeStorage.externalAddresses.oracle.requestPrice(derivativeStorage.fixedParameters.product, requestedTime);
        if (expectedTime == 0) {
            // The Oracle price is already available, settle the contract right away.
            settle();
        }
    }

    function _pullAllAuthorizedTokens(IERC20 erc20) private returns (uint amount) {
        amount = erc20.allowance(msg.sender, address(this));
        require(erc20.transferFrom(msg.sender, address(this), amount));
    } 

    function _computeNewTokenState(
        TokenState storage beginningTokenState, int latestUnderlyingPrice, uint recomputeTime)
        private
        view
        returns (TokenState memory newTokenState) {

            int underlyingReturn = derivativeStorage.externalAddresses.returnCalculator.computeReturn(
                beginningTokenState.underlyingPrice, latestUnderlyingPrice);
            int tokenReturn = underlyingReturn.sub(
                int(derivativeStorage.fixedParameters.fixedFeePerSecond.mul(recomputeTime.sub(beginningTokenState.time))));
            int tokenMultiplier = tokenReturn.add(1 ether);
            int newTokenPrice = 0;
            if (tokenMultiplier > 0) {
                newTokenPrice = _takePercentage(beginningTokenState.tokenPrice, uint(tokenMultiplier));
            }
            newTokenState = TokenState(latestUnderlyingPrice, newTokenPrice, recomputeTime);
        }

    function _computeNavFromTokenPrice(int tokenPrice) private view returns (int navNew) {
        navNew = int(totalSupply()).mul(tokenPrice).div(1 ether);
        assert(navNew >= 0);
    }

    function _takePercentage(uint value, uint percentage) private pure returns (uint result) {
        return value.mul(percentage).div(1 ether);
    }

    function _takePercentage(int value, uint percentage) private pure returns (int result) {
        return value.mul(int(percentage)).div(1 ether);
    }
}


contract TokenizedDerivativeCreator is ContractCreator {

    struct Params {
        address sponsor;
        address admin;
        uint  defaultPenalty; // Percentage of nav * 10^18
        uint requiredMargin; // Percentage of nav * 10^18
        bytes32 product;
        uint fixedYearlyFee; // Percentage of nav * 10^18
        uint  disputeDeposit; // Percentage of nav * 10^18
        address returnCalculator;
        uint startingTokenPrice;
        uint expiry;
        address marginCurrency;
        uint  withdrawLimit; // Percentage of derivativeStorage.shortBalance * 10^18
        string name;
        string symbol;
    }

    constructor(address registryAddress, address _oracleAddress, address _storeAddress, address _priceFeedAddress)
        public
        ContractCreator(
            registryAddress, _oracleAddress, _storeAddress, _priceFeedAddress) { // solhint-disable-line no-empty-blocks
        } 

    function createTokenizedDerivative(Params memory params)
        public
        returns (address derivativeAddress)
    {
        TokenizedDerivative derivative = new TokenizedDerivative(_convertParams(params), params.name, params.symbol);

        address[] memory parties = new address[](1);
        parties[0] = params.sponsor;

        _registerContract(parties, address(derivative));

        return address(derivative);
    }

    // Converts createTokenizedDerivative params to TokenizedDerivative constructor params.
    function _convertParams(Params memory params)
        private
        view
        returns (TokenizedDerivativeParams.ConstructorParams memory constructorParams)
    {
        // Copy externally provided variables.
        constructorParams.sponsor = params.sponsor;
        constructorParams.admin = params.admin;
        constructorParams.defaultPenalty = params.defaultPenalty;
        constructorParams.requiredMargin = params.requiredMargin;
        constructorParams.product = params.product;
        constructorParams.fixedYearlyFee = params.fixedYearlyFee;
        constructorParams.disputeDeposit = params.disputeDeposit;
        constructorParams.returnCalculator = params.returnCalculator;
        constructorParams.startingTokenPrice = params.startingTokenPrice;
        constructorParams.expiry = params.expiry;
        constructorParams.marginCurrency = params.marginCurrency;
        constructorParams.withdrawLimit = params.withdrawLimit;

        // Copy internal variables.
        constructorParams.priceFeed = priceFeedAddress;
        constructorParams.oracle = oracleAddress;
        constructorParams.store = storeAddress;
    }
}
