/*
  Tokenized Derivative implementation

  Implements a simplified version of tokenized Product/ETH Products.
*/
pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "./AdminInterface.sol";
import "./ContractCreator.sol";
import "./ExpandedIERC20.sol";
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
        uint defaultPenalty; // Percentage of nav * 10^18
        uint requiredMargin; // Percentage of nav * 10^18
        bytes32 product;
        uint fixedYearlyFee; // Percentage of nav * 10^18
        uint disputeDeposit; // Percentage of nav * 10^18
        address returnCalculator;
        uint startingTokenPrice;
        uint expiry;
        address marginCurrency;
        uint withdrawLimit; // Percentage of derivativeStorage.shortBalance * 10^18
    }
}

// TokenizedDerivativeStorage: this library name is shortened due to it being used so often.
library TDS {
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
}

library TokenizedDerivativeUtils {
    using TokenizedDerivativeUtils for TDS.Storage;
    using SafeMath for uint;
    using SignedSafeMath for int;

    uint private constant SECONDS_PER_DAY = 86400;
    uint private constant SECONDS_PER_YEAR = 31536000;

    modifier onlySponsor(TDS.Storage storage s) {
        require(msg.sender == s.externalAddresses.sponsor);
        _;
    }

    modifier onlyAdmin(TDS.Storage storage s) {
        require(msg.sender == s.externalAddresses.admin);
        _;
    }

    modifier onlySponsorOrAdmin(TDS.Storage storage s) {
        require(msg.sender == s.externalAddresses.sponsor || msg.sender == s.externalAddresses.admin);
        _;
    }

    modifier onlySponsorOrApDelegate(TDS.Storage storage s) {
        require(msg.sender == s.externalAddresses.sponsor || msg.sender == s.externalAddresses.apDelegate);
        _;
    }

    // Contract initializer. Should only be called at construction.
    // Note: Must be a public function because structs cannot be passed as calldata (required data type for external
    // functions).
    function _initialize(TDS.Storage storage s, TokenizedDerivativeParams.ConstructorParams memory params) public {
        // The default penalty must be less than the required margin, which must be less than the NAV.
        require(params.defaultPenalty <= params.requiredMargin);
        require(params.requiredMargin <= 1 ether);
        s.fixedParameters.marginRequirement = params.requiredMargin;

        s.externalAddresses.marginCurrency = IERC20(params.marginCurrency);
        
        // Keep the starting token price relatively close to 1 ether to prevent users from unintentionally creating
        // rounding or overflow errors.
        require(params.startingTokenPrice >= uint(1 ether).div(10**9));
        require(params.startingTokenPrice <= uint(1 ether).mul(10**9));

        // Address information
        s.externalAddresses.oracle = OracleInterface(params.oracle);
        s.externalAddresses.store = StoreInterface(params.store);
        s.externalAddresses.priceFeed = PriceFeedInterface(params.priceFeed);
        // Verify that the price feed and s.externalAddresses.oracle support the given s.fixedParameters.product.
        require(s.externalAddresses.oracle.isIdentifierSupported(params.product));
        require(s.externalAddresses.priceFeed.isIdentifierSupported(params.product));

        s.externalAddresses.sponsor = params.sponsor;
        s.externalAddresses.admin = params.admin;
        s.externalAddresses.returnCalculator = ReturnCalculatorInterface(params.returnCalculator);

        // Contract parameters.
        s.fixedParameters.defaultPenalty = params.defaultPenalty;
        s.fixedParameters.product = params.product;
        s.fixedParameters.fixedFeePerSecond = params.fixedYearlyFee.div(SECONDS_PER_YEAR);
        s.fixedParameters.disputeDeposit = params.disputeDeposit;

        // TODO(mrice32): we should have an ideal start time rather than blindly polling.
        (uint latestTime, int latestUnderlyingPrice) = s.externalAddresses.priceFeed.latestPrice(s.fixedParameters.product);
        require(latestTime != 0);

        // Set end time to max value of uint to implement no expiry.
        if (params.expiry == 0) {
            s.endTime = ~uint(0);
        } else {
            require(params.expiry >= latestTime);
            s.endTime = params.expiry;
        }

        s.nav = s._computeInitialNav(latestUnderlyingPrice, latestTime, params.startingTokenPrice);

        s.state = TDS.State.Live;

        require(params.withdrawLimit < 1 ether);
        s.fixedParameters.withdrawLimit = params.withdrawLimit;
    }

    function _depositAndCreateTokens(TDS.Storage storage s, uint newTokenNav) external onlySponsorOrApDelegate(s) {
        // Subtract newTokenNav from amount sent.
        uint sentAmount = s._pullSentMargin();
        uint depositAmount = sentAmount.sub(newTokenNav);

        // Deposit additional margin into the short account.
        s._depositInternal(depositAmount);

        // Create new newTokenNav worth of tokens.
        s._createTokensInternal(newTokenNav);
    }

    function _redeemTokens(TDS.Storage storage s) external {
        require(s.state == TDS.State.Live || s.state == TDS.State.Settled);

        if (s.state == TDS.State.Live) {
            require(msg.sender == s.externalAddresses.sponsor || msg.sender == s.externalAddresses.apDelegate);
            s._remarginInternal();
        }

        ExpandedIERC20 thisErc20Token = ExpandedIERC20(address(this));

        uint initialSupply = thisErc20Token.totalSupply();

        uint numTokens = _pullAllAuthorizedTokens(thisErc20Token);
        require(numTokens > 0);
        thisErc20Token.burn(numTokens);

        // Value of the tokens is just the percentage of all the tokens multiplied by the balance of the investor
        // margin account.
        assert(s.longBalance >= 0);
        uint tokenPercentage = numTokens.mul(1 ether).div(initialSupply);
        uint tokenValue = _takePercentage(uint(s.longBalance), tokenPercentage);

        s.longBalance = s.longBalance.sub(int(tokenValue));
        s.nav = _computeNavFromTokenPrice(s.currentTokenState.tokenPrice);

        s._sendMargin(tokenValue);
    }

    function _dispute(TDS.Storage storage s) external onlySponsor(s) {
        require(
            s.state == TDS.State.Live,
            "Contract must be Live to dispute"
        );

        uint requiredDeposit = uint(_takePercentage(s.nav, s.fixedParameters.disputeDeposit));

        uint sentAmount = s._pullSentMargin();

        require(sentAmount >= requiredDeposit);
        uint refund = sentAmount.sub(requiredDeposit);

        s.state = TDS.State.Disputed;
        s.endTime = s.currentTokenState.time;
        s.disputeInfo.disputedNav = s.nav;
        s.disputeInfo.deposit = requiredDeposit;

        s._requestOraclePrice(s.endTime);

        s._sendMargin(refund);
    }

    function _withdraw(TDS.Storage storage s, uint amount) external onlySponsor(s) {
        // Remargin before allowing a withdrawal, but only if in the live state.
        if (s.state == TDS.State.Live) {
            s._remarginInternal();
        }

        // Make sure either in Live or Settled after any necessary remargin.
        require(s.state == TDS.State.Live || s.state == TDS.State.Settled);

        // If the contract has been settled or is in prefunded state then can
        // withdraw up to full balance. If the contract is in live state then
        // must leave at least `requiredMargin`. Not allowed to withdraw in
        // other states.
        int withdrawableAmount;
        if (s.state == TDS.State.Settled) {
            withdrawableAmount = s.shortBalance;
        } else {
            // Update throttling snapshot and verify that this withdrawal doesn't go past the throttle limit.
            uint currentTime = s.currentTokenState.time;
            if (s.withdrawThrottle.startTime <= currentTime.sub(SECONDS_PER_DAY)) {
                // We've passed the previous s.withdrawThrottle window. Start new one.
                s.withdrawThrottle.startTime = currentTime;
                s.withdrawThrottle.remainingWithdrawal = _takePercentage(uint(s.shortBalance), s.fixedParameters.withdrawLimit);
            }

            int marginMaxWithdraw = s.shortBalance.sub(s._getRequiredEthMargin(s.nav));
            int throttleMaxWithdraw = int(s.withdrawThrottle.remainingWithdrawal);

            // Take the smallest of the two withdrawal limits.
            withdrawableAmount = throttleMaxWithdraw < marginMaxWithdraw ? throttleMaxWithdraw : marginMaxWithdraw;

            // Note: this line alone implicitly ensures the withdrawal throttle is not violated, but the above
            // ternary is more explicit.
            s.withdrawThrottle.remainingWithdrawal = s.withdrawThrottle.remainingWithdrawal.sub(amount);
        }

        // Can only withdraw the allowed amount.
        require(
            withdrawableAmount >= int(amount),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return.
        s.shortBalance = s.shortBalance.sub(int(amount));
        s._sendMargin(amount);
    }

    function _confirmPrice(TDS.Storage storage s) external onlySponsor(s) {
        // Right now, only confirming prices in the defaulted state.
        require(s.state == TDS.State.Defaulted);

        // Remargin on agreed upon price.
        s._settleAgreedPrice();
    }

    function _setApDelegate(TDS.Storage storage s, address _apDelegate) external onlySponsor(s) {
        s.externalAddresses.apDelegate = _apDelegate;
    }

    // Moves the contract into the Emergency state, where it waits on an Oracle price for the most recent remargin time.
    function _emergencyShutdown(TDS.Storage storage s) external onlyAdmin(s) {
        require(s.state == TDS.State.Live);
        s.state = TDS.State.Emergency;
        s.endTime = s.currentTokenState.time;
        s._requestOraclePrice(s.endTime);
    }

    function _settle(TDS.Storage storage s) external {
        s._settleInternal();
    }

    function _createTokens(TDS.Storage storage s) external onlySponsorOrApDelegate(s) {
        s._createTokensInternal(s._pullSentMargin());
    }

    function _deposit(TDS.Storage storage s) external onlySponsor(s) {
        // Only allow the s.externalAddresses.sponsor to deposit margin.
        s._depositInternal(s._pullSentMargin());
    }

    // Returns the expected net asset value (NAV) of the contract using the latest available Price Feed price.
    function _calcNAV(TDS.Storage storage s) external view returns (int navNew) {
        (uint latestTime, int latestUnderlyingPrice) = s._getLatestPrice();
        require(latestTime < s.endTime);

        TDS.TokenState memory predictedTokenState = s._computeNewTokenState(
            s.currentTokenState, latestUnderlyingPrice, latestTime);
        navNew = _computeNavFromTokenPrice(predictedTokenState.tokenPrice);
    }

    // Returns the expected value of each the outstanding tokens of the contract using the latest available Price Feed
    // price.
    function _calcTokenValue(TDS.Storage storage s) external view returns (int newTokenValue) {
        (uint latestTime, int latestUnderlyingPrice) = s._getLatestPrice();
        require(latestTime < s.endTime);

        TDS.TokenState memory predictedTokenState = s._computeNewTokenState(
            s.currentTokenState, latestUnderlyingPrice, latestTime);
        newTokenValue = predictedTokenState.tokenPrice;
    }

    // Returns the expected balance of the short margin account using the latest available Price Feed price.
    function _calcShortMarginBalance(TDS.Storage storage s) external view returns (int newShortMarginBalance) {
        (, newShortMarginBalance) = s._calcNewNavAndBalance();
    }

    function _calcExcessMargin(TDS.Storage storage s) external view returns (int newExcessMargin) {
        (int navNew, int newShortMarginBalance) = s._calcNewNavAndBalance();
        int requiredMargin = s._getRequiredEthMargin(navNew);
        return newShortMarginBalance.sub(requiredMargin);
    }

    function _calcNewNavAndBalance(TDS.Storage storage s) internal view returns (int navNew, int newShortMarginBalance)
    {
        (uint latestTime, int latestUnderlyingPrice) = s._getLatestPrice();
        require(latestTime < s.endTime);

        TDS.TokenState memory predictedTokenState = s._computeNewTokenState(
            s.currentTokenState, latestUnderlyingPrice, latestTime);
        navNew = _computeNavFromTokenPrice(predictedTokenState.tokenPrice);
        int longDiff = s._getLongNavDiff(navNew);

        uint feeAmount = s._computeExpectedOracleFees(s.currentTokenState.time, latestTime, s.nav);

        newShortMarginBalance = s.shortBalance.sub(longDiff).sub(int(feeAmount));
    }

    function _computeInitialNav(TDS.Storage storage s, int latestUnderlyingPrice, uint latestTime, uint startingTokenPrice)
        internal
        returns (int navNew)
    {
        int unitNav = int(startingTokenPrice);
        s.prevTokenState = TDS.TokenState(latestUnderlyingPrice, unitNav, latestTime);
        s.currentTokenState = TDS.TokenState(latestUnderlyingPrice, unitNav, latestTime);
        // Starting NAV is always 0 in the TokenizedDerivative case.
        navNew = 0;
    }

    function _remargin(TDS.Storage storage s) external onlySponsorOrAdmin(s) {
        s._remarginInternal();
    }

    // _remarginInternal() allows other functions to call remargin internally without satisfying permission checks for
    // _remargin().
    function _remarginInternal(TDS.Storage storage s) internal {
        // If the state is not live, remargining does not make sense.
        require(s.state == TDS.State.Live);

        (uint latestTime, int latestPrice) = s._getLatestPrice();
        // Checks whether contract has ended.
        if (latestTime <= s.currentTokenState.time) {
            // If the price feed hasn't advanced, remargining should be a no-op.
            return;
        }
        if (latestTime >= s.endTime) {
            s.state = TDS.State.Expired;
            s.prevTokenState = s.currentTokenState;
            uint feeAmount = s._deductOracleFees(s.currentTokenState.time, s.endTime, s.nav);

            // We have no idea what the price was, exactly at s.endTime, so we can't set
            // s.currentTokenState, or update the nav, or do anything.
            s._requestOraclePrice(s.endTime);
            s._payOracleFees(feeAmount);
            return;
        }
        uint feeAmount = s._deductOracleFees(s.currentTokenState.time, latestTime, s.nav);

        // Update nav of contract.
        int navNew = s._computeNav(latestPrice, latestTime);
        
        // Save the current NAV in case it's required to compute the default penalty.
        int previousNav = s.nav;

        // Update the balances of the contract.
        s._updateBalances(navNew);

        // Make sure contract has not moved into default.
        bool inDefault = !s._satisfiesMarginRequirement(s.shortBalance, s.nav);
        if (inDefault) {
            s.state = TDS.State.Defaulted;
            s.navAtDefault = previousNav;
            s.endTime = latestTime; // Change end time to moment when default occurred.
        }

        if (inDefault) {
            s._requestOraclePrice(s.endTime);
        }

        s._payOracleFees(feeAmount);
    }

    function _createTokensInternal(TDS.Storage storage s, uint navToPurchase) internal {
        s._remarginInternal();

        // Verify that remargining didn't push the contract into expiry or default.
        require(s.state == TDS.State.Live);

        s.longBalance = s.longBalance.add(int(navToPurchase));

        ExpandedIERC20 thisErc20Token = ExpandedIERC20(address(this));

        thisErc20Token.mint(msg.sender, uint(_tokensFromNav(int(navToPurchase), s.currentTokenState.tokenPrice)));

        s.nav = _computeNavFromTokenPrice(s.currentTokenState.tokenPrice);

        // Make sure this still satisfies the margin requirement.
        require(s._satisfiesMarginRequirement(s.shortBalance, s.nav));
    }

    function _depositInternal(TDS.Storage storage s, uint value) internal {
        // Make sure that we are in a "depositable" state.
        require(s.state == TDS.State.Live);
        s.shortBalance = s.shortBalance.add(int(value));
    }

    function _settleInternal(TDS.Storage storage s) internal {
        TDS.State startingState = s.state;
        require(startingState == TDS.State.Disputed || startingState == TDS.State.Expired
                || startingState == TDS.State.Defaulted || startingState == TDS.State.Emergency);
        s._settleVerifiedPrice();
        if (startingState == TDS.State.Disputed) {
            int depositValue = int(s.disputeInfo.deposit);
            if (s.nav != s.disputeInfo.disputedNav) {
                s.shortBalance = s.shortBalance.add(depositValue);
            } else {
                s.longBalance = s.longBalance.add(depositValue);
            }
        }
    }

    // Deducts the fees from the margin account.
    function _deductOracleFees(TDS.Storage storage s, uint lastTimeOracleFeesPaid, uint currentTime, int lastTokenNav) internal returns (uint feeAmount) {
        feeAmount = s._computeExpectedOracleFees(lastTimeOracleFeesPaid, currentTime, lastTokenNav);
        s.shortBalance = s.shortBalance.sub(int(feeAmount));
        // If paying the Oracle fee reduces the held margin below requirements, the rest of remargin() will default the
        // contract.
    }

    // Pays out the fees to the Oracle.
    function _payOracleFees(TDS.Storage storage s, uint feeAmount) internal {
        if (feeAmount == 0) {
            return;
        }

        if (address(s.externalAddresses.marginCurrency) == address(0x0)) {
            s.externalAddresses.store.payOracleFees.value(feeAmount)();
        } else {
            require(s.externalAddresses.marginCurrency.approve(address(s.externalAddresses.store), feeAmount));
            s.externalAddresses.store.payOracleFeesErc20(address(s.externalAddresses.marginCurrency));
        }
    }

    function _computeExpectedOracleFees(TDS.Storage storage s, uint lastTimeOracleFeesPaid, uint currentTime, int lastTokenNav)
        internal
        view
        returns (uint feeAmount)
    {
        uint expectedFeeAmount = s.externalAddresses.store.computeOracleFees(lastTimeOracleFeesPaid, currentTime, uint(lastTokenNav));
        return (uint(s.shortBalance) < expectedFeeAmount) ? uint(s.shortBalance) : expectedFeeAmount;
    }

    function _computeNewTokenState(TDS.Storage storage s,
        TDS.TokenState storage beginningTokenState, int latestUnderlyingPrice, uint recomputeTime)
        internal
        view
        returns (TDS.TokenState memory newTokenState)
    {
            int underlyingReturn = s.externalAddresses.returnCalculator.computeReturn(
                beginningTokenState.underlyingPrice, latestUnderlyingPrice);
            int tokenReturn = underlyingReturn.sub(
                int(s.fixedParameters.fixedFeePerSecond.mul(recomputeTime.sub(beginningTokenState.time))));
            int tokenMultiplier = tokenReturn.add(1 ether);
            int newTokenPrice = 0;
            if (tokenMultiplier > 0) {
                newTokenPrice = _takePercentage(beginningTokenState.tokenPrice, uint(tokenMultiplier));
            }
            newTokenState = TDS.TokenState(latestUnderlyingPrice, newTokenPrice, recomputeTime);
    }

    function _satisfiesMarginRequirement(TDS.Storage storage s, int balance, int currentNav)
        internal
        view
        returns (bool doesSatisfyRequirement) 
    {
        return s._getRequiredEthMargin(currentNav) <= balance;
    }

    function _requestOraclePrice(TDS.Storage storage s, uint requestedTime) internal {
        uint expectedTime = s.externalAddresses.oracle.requestPrice(s.fixedParameters.product, requestedTime);
        if (expectedTime == 0) {
            // The Oracle price is already available, settle the contract right away.
            s._settleInternal();
        }
    }

    function _getLatestPrice(TDS.Storage storage s) internal view returns (uint latestTime, int latestUnderlyingPrice) {
        // If not live, then we should be using the Oracle not the price feed.
        require(s.state == TDS.State.Live);

        (latestTime, latestUnderlyingPrice) = s.externalAddresses.priceFeed.latestPrice(s.fixedParameters.product);
        require(latestTime != 0);
    }

    function _computeNav(TDS.Storage storage s, int latestUnderlyingPrice, uint latestTime) internal returns (int navNew) {
        s.prevTokenState = s.currentTokenState;
        s.currentTokenState = s._computeNewTokenState(s.currentTokenState, latestUnderlyingPrice, latestTime);
        navNew = _computeNavFromTokenPrice(s.currentTokenState.tokenPrice);
    }

    function _recomputeNav(TDS.Storage storage s, int oraclePrice, uint recomputeTime) internal returns (int navNew) {
        // We're updating `last` based on what the Oracle has told us.
        // TODO(ptare): Add ability for the Oracle to correct the time as well.
        assert(s.endTime == recomputeTime);
        s.currentTokenState = s._computeNewTokenState(s.prevTokenState, oraclePrice, recomputeTime);
        navNew = _computeNavFromTokenPrice(s.currentTokenState.tokenPrice);
    }

    // Function is internally only called by `_settleAgreedPrice` or `_settleVerifiedPrice`. This function handles all 
    // of the settlement logic including assessing penalties and then moves the state to `Settled`.
    function _settleWithPrice(TDS.Storage storage s, int price) internal {

        // Remargin at whatever price we're using (verified or unverified).
        s._updateBalances(s._recomputeNav(price, s.endTime));

        bool inDefault = !s._satisfiesMarginRequirement(s.shortBalance, s.nav);

        if (inDefault) {
            int expectedDefaultPenalty = s._getDefaultPenaltyEth();
            int penalty = (s.shortBalance < expectedDefaultPenalty) ?
                s.shortBalance :
                expectedDefaultPenalty;

            s.shortBalance = s.shortBalance.sub(penalty);
            s.longBalance = s.longBalance.add(penalty);
        }

        s.state = TDS.State.Settled;
    }

    function _updateBalances(TDS.Storage storage s, int navNew) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update nav state variable.
        int longDiff = s._getLongNavDiff(navNew);
        s.nav = navNew;

        s.longBalance = s.longBalance.add(longDiff);
        s.shortBalance = s.shortBalance.sub(longDiff);
    }

    // Gets the change in balance for the long side.
    // Note: there's a function for this because signage is tricky here, and it must be done the same everywhere.
    function _getLongNavDiff(TDS.Storage storage s, int navNew) internal view returns (int longNavDiff) {
        return navNew.sub(s.nav);
    }

    function _getDefaultPenaltyEth(TDS.Storage storage s) internal view returns (int penalty) {
        return _takePercentage(s.navAtDefault, s.fixedParameters.defaultPenalty);
    }

    function _getRequiredEthMargin(TDS.Storage storage s, int currentNav)
        internal
        view
        returns (int requiredEthMargin)
    {
        return _takePercentage(currentNav, s.fixedParameters.marginRequirement);
    }

    function _pullSentMargin(TDS.Storage storage s) internal returns (uint amount) {
        if (address(s.externalAddresses.marginCurrency) == address(0x0)) {
            return msg.value;
        } else {
            // If we expect an ERC20 token, no ETH should be sent.
            require(msg.value == 0);
            return _pullAllAuthorizedTokens(s.externalAddresses.marginCurrency);
        }
    }

    function _sendMargin(TDS.Storage storage s, uint amount) internal {
        if (address(s.externalAddresses.marginCurrency) == address(0x0)) {
            msg.sender.transfer(amount);
        } else {
            require(s.externalAddresses.marginCurrency.transfer(msg.sender, amount));
        }
    }

    function _settleAgreedPrice(TDS.Storage storage s) internal {
        int agreedPrice = s.currentTokenState.underlyingPrice;

        s._settleWithPrice(agreedPrice);
    }

    function _settleVerifiedPrice(TDS.Storage storage s) internal {
        int oraclePrice = s.externalAddresses.oracle.getPrice(s.fixedParameters.product, s.endTime);
        s._settleWithPrice(oraclePrice);
    }

    function _tokensFromNav(int currentNav, int unitNav) private pure returns (int numTokens) {
        if (unitNav <= 0) {
            return 0;
        } else {
            return currentNav.mul(1 ether).div(unitNav);
        }
    }

    function _pullAllAuthorizedTokens(IERC20 erc20) private returns (uint amount) {
        amount = erc20.allowance(msg.sender, address(this));
        require(erc20.transferFrom(msg.sender, address(this), amount));
    }

    function _computeNavFromTokenPrice(int tokenPrice) private view returns (int navNew) {
        ExpandedIERC20 thisErc20Token = ExpandedIERC20(address(this));
        navNew = int(thisErc20Token.totalSupply()).mul(tokenPrice).div(1 ether);
        assert(navNew >= 0);
    }

    function _takePercentage(uint value, uint percentage) private pure returns (uint result) {
        return value.mul(percentage).div(1 ether);
    }

    function _takePercentage(int value, uint percentage) private pure returns (int result) {
        return value.mul(int(percentage)).div(1 ether);
    }
}


// TODO(mrice32): make this and TotalReturnSwap derived classes of a single base to encap common functionality.
contract TokenizedDerivative is ERC20, AdminInterface, ExpandedIERC20 {
    using TokenizedDerivativeUtils for TDS.Storage;

    // Note: these variables are to give ERC20 consumers information about the token.
    string public name;
    string public symbol;
    uint8 public constant decimals = 18; // solhint-disable-line const-name-snakecase

    TDS.Storage public derivativeStorage;

    // TODO(ptare): Adding name and symbol to ConstructorParams causes the transaction to always revert without a useful
    // error message. Need to investigate this issue more.
    constructor(
        TokenizedDerivativeParams.ConstructorParams memory params,
        string memory _name,
        string memory _symbol
    ) public {
        // Set token properties.
        name = _name;
        symbol = _symbol;

        // Initialize the contract.
        derivativeStorage._initialize(params);
    }

    function createTokens() external payable {
        derivativeStorage._createTokens();
    }

    function depositAndCreateTokens(uint newTokenNav) external payable {
        derivativeStorage._depositAndCreateTokens(newTokenNav);
    }

    function redeemTokens() external {
        derivativeStorage._redeemTokens();
    }

    function dispute() external payable {
        derivativeStorage._dispute();
    }

    function withdraw(uint amount) external {
        derivativeStorage._withdraw(amount);
    }

    function remargin() external {
        derivativeStorage._remargin();
    }

    function confirmPrice() external {
        derivativeStorage._confirmPrice();
    }

    function setApDelegate(address apDelegate) external {
        derivativeStorage._setApDelegate(apDelegate);
    }

    // Moves the contract into the Emergency state, where it waits on an Oracle price for the most recent remargin time.
    function emergencyShutdown() external {
        derivativeStorage._emergencyShutdown();
    }

    // Returns the expected net asset value (NAV) of the contract using the latest available Price Feed price.
    function calcNAV() external view returns (int navNew) {
        return derivativeStorage._calcNAV();
    }

    // Returns the expected value of each the outstanding tokens of the contract using the latest available Price Feed
    // price.
    function calcTokenValue() external view returns (int newTokenValue) {
        return derivativeStorage._calcTokenValue();
    }

    // Returns the expected balance of the short margin account using the latest available Price Feed price.
    function calcShortMarginBalance() external view returns (int newShortMarginBalance) {
        return derivativeStorage._calcShortMarginBalance();
    }

    // Returns the expected short margin in excess of the margin requirement using the latest available Price Feed
    // price.  Value will be negative if the short margin is expected to be below the margin requirement.
    function calcExcessMargin() external view returns (int excessMargin) {
        return derivativeStorage._calcExcessMargin();
    }

    function settle() public {
        derivativeStorage._settle();
    }

    function deposit() public payable {
        derivativeStorage._deposit();
    }

    // ExpandedIERC20 methods.
    modifier onlyThis {
        require(msg.sender == address(this));
        _;
    }

    // Only allow calls from this contract or its libraries to burn tokens.
    function burn(uint value) external onlyThis {
        // Only allow calls from this contract or its libraries to burn tokens.
        _burn(msg.sender, value);
    }

    // Only allow calls from this contract or its libraries to mint tokens.
    function mint(address to, uint256 value) external onlyThis {
        _mint(to, value);
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
