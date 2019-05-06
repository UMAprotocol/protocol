/*
  Tokenized Derivative implementation

  Implements a simplified version of tokenized Product/ETH Products.
*/
pragma solidity ^0.5.0;

pragma experimental ABIEncoderV2;

import "./AdminInterface.sol";
import "./AddressWhitelist.sol";
import "./ContractCreator.sol";
import "./ExpandedIERC20.sol";
import "./OracleInterface.sol";
import "./PriceFeedInterface.sol";
import "./ReturnCalculatorInterface.sol";
import "./StoreInterface.sol";
import "./Testable.sol";

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/drafts/SignedSafeMath.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


library TokenizedDerivativeParams {
    enum ReturnType {
        Linear,
        Compound
    }

    struct ConstructorParams {
        address sponsor;
        address admin;
        address oracle;
        address store;
        address priceFeed;
        uint defaultPenalty; // Percentage of margin requirement * 10^18
        uint supportedMove; // Expected percentage move in the underlying price that the long is protected against.
        bytes32 product;
        uint fixedYearlyFee; // Percentage of nav * 10^18
        uint disputeDeposit; // Percentage of margin requirement * 10^18
        address returnCalculator;
        uint startingTokenPrice;
        uint expiry;
        address marginCurrency;
        uint withdrawLimit; // Percentage of derivativeStorage.shortBalance * 10^18
        ReturnType returnType;
        uint startingUnderlyingPrice;
        uint creationTime;
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

        // The sponsor has disputed the price feed output. If the dispute is valid (i.e., the NAV calculated from the
        // Oracle price differs from the NAV calculated from the price feed), the dispute fee is added to the short
        // account. Otherwise, the dispute fee is added to the long margin account.
        // Possible state transitions: Settled.
        Disputed,

        // Contract expiration has been reached.
        // Possible state transitions: Settled.
        Expired,

        // The short margin account is below its margin requirement. The sponsor can choose to confirm the default and
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
        uint defaultPenalty; // Percentage of margin requirement * 10^18
        uint supportedMove; // Expected percentage move that the long is protected against.
        uint disputeDeposit; // Percentage of margin requirement * 10^18
        uint fixedFeePerSecond; // Percentage of nav*10^18
        uint withdrawLimit; // Percentage of derivativeStorage.shortBalance*10^18
        bytes32 product;
        TokenizedDerivativeParams.ReturnType returnType;
        uint initialTokenUnderlyingRatio;
        uint creationTime;
        string symbol;
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
        // In the case of a remargin, a `latest` price is retrieved from the price feed, and we shift
        // `current` -> `prev` and `latest` -> `current` (and then recompute).
        // In the case of a dispute, `current` might change (which is why we have to hold on to `prev`).
        TokenState referenceTokenState;
        TokenState currentTokenState;

        int nav;  // Net asset value is measured in Wei

        Dispute disputeInfo;

        // Only populated once the contract enters a frozen state.
        int defaultPenaltyAmount;

        WithdrawThrottle withdrawThrottle;
    }
}


library TokenizedDerivativeUtils {
    using TokenizedDerivativeUtils for TDS.Storage;
    using SafeMath for uint;
    using SignedSafeMath for int;

    uint private constant SECONDS_PER_DAY = 86400;
    uint private constant SECONDS_PER_YEAR = 31536000;
    uint private constant INT_MAX = 2**255 - 1;
    uint private constant UINT_FP_SCALING_FACTOR = 10**18;
    int private constant INT_FP_SCALING_FACTOR = 10**18;

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

    function _depositAndCreateTokens(TDS.Storage storage s, uint marginForPurchase, uint tokensToPurchase)
        external 
        onlySponsorOrApDelegate(s)
    {
        s._remarginInternal();

        int newTokenNav = _computeNavForTokens(s.currentTokenState.tokenPrice, tokensToPurchase);

        if (newTokenNav < 0) {
            newTokenNav = 0;
        }

        uint positiveTokenNav = _safeUintCast(newTokenNav);

        // Get any refund due to sending more margin than the argument indicated (should only be able to happen in the
        // ETH case).
        uint refund = s._pullSentMargin(marginForPurchase);

        // Subtract newTokenNav from amount sent.
        uint depositAmount = marginForPurchase.sub(positiveTokenNav);

        // Deposit additional margin into the short account.
        s._depositInternal(depositAmount);

        // The _createTokensInternal call returns any refund due to the amount sent being larger than the amount
        // required to purchase the tokens, so we add that to the running refund. This should be 0 in this case,
        // but we leave this here in case of some refund being generated due to rounding errors or any bugs to ensure
        // the sender never loses money.
        refund = refund.add(s._createTokensInternal(tokensToPurchase, positiveTokenNav));

        // Send the accumulated refund.
        s._sendMargin(refund);
    }

    function _redeemTokens(TDS.Storage storage s, uint tokensToRedeem) external {
        require(s.state == TDS.State.Live || s.state == TDS.State.Settled);
        require(tokensToRedeem > 0);

        if (s.state == TDS.State.Live) {
            require(msg.sender == s.externalAddresses.sponsor || msg.sender == s.externalAddresses.apDelegate);
            s._remarginInternal();
            require(s.state == TDS.State.Live);
        }

        ExpandedIERC20 thisErc20Token = ExpandedIERC20(address(this));

        uint initialSupply = _totalSupply();
        require(initialSupply > 0);

        _pullAuthorizedTokens(thisErc20Token, tokensToRedeem);
        thisErc20Token.burn(tokensToRedeem);
        emit TokensRedeemed(s.fixedParameters.symbol, tokensToRedeem);

        // Value of the tokens is just the percentage of all the tokens multiplied by the balance of the investor
        // margin account.
        uint tokenPercentage = tokensToRedeem.mul(UINT_FP_SCALING_FACTOR).div(initialSupply);
        uint tokenMargin = _takePercentage(_safeUintCast(s.longBalance), tokenPercentage);

        s.longBalance = s.longBalance.sub(_safeIntCast(tokenMargin));
        assert(s.longBalance >= 0);
        s.nav = _computeNavForTokens(s.currentTokenState.tokenPrice, _totalSupply());

        s._sendMargin(tokenMargin);
    }

    function _dispute(TDS.Storage storage s, uint depositMargin) external onlySponsor(s) {
        require(
            s.state == TDS.State.Live,
            "Contract must be Live to dispute"
        );

        uint requiredDeposit = _safeUintCast(
            _takePercentage(s._getRequiredMargin(s.currentTokenState), s.fixedParameters.disputeDeposit));

        uint sendInconsistencyRefund = s._pullSentMargin(depositMargin);

        require(depositMargin >= requiredDeposit);
        uint overpaymentRefund = depositMargin.sub(requiredDeposit);

        s.state = TDS.State.Disputed;
        s.endTime = s.currentTokenState.time;
        s.disputeInfo.disputedNav = s.nav;
        s.disputeInfo.deposit = requiredDeposit;

        // Store the default penalty in case the dispute pushes the sponsor into default.
        s.defaultPenaltyAmount = s._computeDefaultPenalty();
        emit Disputed(s.fixedParameters.symbol, s.endTime, s.nav);

        s._requestOraclePrice(s.endTime);

        // Add the two types of refunds:
        // 1. The refund for ETH sent if it was > depositMargin.
        // 2. The refund for depositMargin > requiredDeposit.
        s._sendMargin(sendInconsistencyRefund.add(overpaymentRefund));
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
        // must leave at least the required margin. Not allowed to withdraw in
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
                s.withdrawThrottle.remainingWithdrawal = _takePercentage(
                    _safeUintCast(s.shortBalance), s.fixedParameters.withdrawLimit);
            }

            int marginMaxWithdraw = s.shortBalance.sub(s._getRequiredMargin(s.currentTokenState));
            int throttleMaxWithdraw = _safeIntCast(s.withdrawThrottle.remainingWithdrawal);

            // Take the smallest of the two withdrawal limits.
            withdrawableAmount = throttleMaxWithdraw < marginMaxWithdraw ? throttleMaxWithdraw : marginMaxWithdraw;

            // Note: this line alone implicitly ensures the withdrawal throttle is not violated, but the above
            // ternary is more explicit.
            s.withdrawThrottle.remainingWithdrawal = s.withdrawThrottle.remainingWithdrawal.sub(amount);
        }

        // Can only withdraw the allowed amount.
        require(
            withdrawableAmount >= _safeIntCast(amount),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return.
        s.shortBalance = s.shortBalance.sub(_safeIntCast(amount));
        emit Withdrawal(s.fixedParameters.symbol, amount);
        s._sendMargin(amount);
    }

    function _acceptPriceAndSettle(TDS.Storage storage s) external onlySponsor(s) {
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
        s.defaultPenaltyAmount = s._computeDefaultPenalty();
        emit EmergencyShutdownTransition(s.fixedParameters.symbol, s.endTime);
        s._requestOraclePrice(s.endTime);
    }

    function _settle(TDS.Storage storage s) external {
        s._settleInternal();
    }

    function _createTokens(TDS.Storage storage s, uint marginForPurchase, uint tokensToPurchase)
        external
        onlySponsorOrApDelegate(s)
    {
        // Returns any refund due to sending more margin than the argument indicated (should only be able to happen in
        // the ETH case).
        uint refund = s._pullSentMargin(marginForPurchase);

        // The _createTokensInternal call returns any refund due to the amount sent being larger than the amount
        // required to purchase the tokens, so we add that to the running refund.
        refund = refund.add(s._createTokensInternal(tokensToPurchase, marginForPurchase));

        // Send the accumulated refund.
        s._sendMargin(refund);
    }

    function _deposit(TDS.Storage storage s, uint marginToDeposit) external onlySponsor(s) {
        // Only allow the s.externalAddresses.sponsor to deposit margin.
        uint refund = s._pullSentMargin(marginToDeposit);
        s._depositInternal(marginToDeposit);

        // Send any refund due to sending more margin than the argument indicated (should only be able to happen in the
        // ETH case).
        s._sendMargin(refund);
    }

    function _remargin(TDS.Storage storage s) external onlySponsorOrAdmin(s) {
        s._remarginInternal();
    }

    function _withdrawUnexpectedErc20(TDS.Storage storage s, address erc20Address, uint amount)
        external
        onlySponsor(s)
    {
        if (address(s.externalAddresses.marginCurrency) == erc20Address) {
            uint currentBalance = s.externalAddresses.marginCurrency.balanceOf(address(this));
            int totalBalances = s.shortBalance.add(s.longBalance);
            assert(totalBalances >= 0);
            uint withdrawableAmount = currentBalance.sub(_safeUintCast(totalBalances)).sub(s.disputeInfo.deposit);
            require(withdrawableAmount >= amount);
        }

        IERC20 erc20 = IERC20(erc20Address);
        require(erc20.transfer(msg.sender, amount));
    }

    // Returns the expected net asset value (NAV) of the contract using the latest available Price Feed price.
    function _calcNAV(TDS.Storage storage s) external view returns (int navNew) {
        (TDS.TokenState memory newTokenState, ) = s._calcNewTokenStateAndBalance();
        navNew = _computeNavForTokens(newTokenState.tokenPrice, _totalSupply());
    }

    // Returns the expected value of each the outstanding tokens of the contract using the latest available Price Feed
    // price.
    function _calcTokenValue(TDS.Storage storage s) external view returns (int newTokenValue) {
        (TDS.TokenState memory newTokenState,) = s._calcNewTokenStateAndBalance();
        newTokenValue = newTokenState.tokenPrice;
    }

    // Returns the expected balance of the short margin account using the latest available Price Feed price.
    function _calcShortMarginBalance(TDS.Storage storage s) external view returns (int newShortMarginBalance) {
        (, newShortMarginBalance) = s._calcNewTokenStateAndBalance();
    }

    function _calcExcessMargin(TDS.Storage storage s) external view returns (int newExcessMargin) {
        (TDS.TokenState memory newTokenState, int newShortMarginBalance) = s._calcNewTokenStateAndBalance();
        // If the contract is in/will be moved to a settled state, the margin requirement will be 0.
        int requiredMargin = newTokenState.time >= s.endTime ? 0 : s._getRequiredMargin(newTokenState);
        return newShortMarginBalance.sub(requiredMargin);
    }

    function _getCurrentRequiredMargin(TDS.Storage storage s) external view returns (int requiredMargin) {
        if (s.state == TDS.State.Settled) {
            // No margin needs to be maintained when the contract is settled.
            return 0;
        }

        return s._getRequiredMargin(s.currentTokenState);
    }

    function _canBeSettled(TDS.Storage storage s) external view returns (bool canBeSettled) {
        TDS.State currentState = s.state;

        if (currentState == TDS.State.Settled) {
            return false;
        }

        // Technically we should also check if price will default the contract, but that isn't a normal flow of
        // operations that we want to simulate: we want to discourage the sponsor remargining into a default.
        (uint priceFeedTime, ) = s._getLatestPrice();
        if (currentState == TDS.State.Live && (priceFeedTime < s.endTime)) {
            return false;
        }

        return s.externalAddresses.oracle.hasPrice(s.fixedParameters.product, s.endTime);
    }

    function _getUpdatedUnderlyingPrice(TDS.Storage storage s) external view returns (int underlyingPrice, uint time) {
        (TDS.TokenState memory newTokenState, ) = s._calcNewTokenStateAndBalance();
        return (newTokenState.underlyingPrice, newTokenState.time);
    }

    // Contract initializer. Should only be called at construction.
    // Note: Must be a public function because structs cannot be passed as calldata (required data type for external
    // functions).
    function _initialize(
        TDS.Storage storage s,
        TokenizedDerivativeParams.ConstructorParams memory params,
        string memory symbol
    ) 
        public 
    {

        s._setFixedParameters(params, symbol);
        s._setExternalAddresses(params);
        
        // Keep the starting token price relatively close to FP_SCALING_FACTOR to prevent users from unintentionally
        // creating rounding or overflow errors.
        require(params.startingTokenPrice >= UINT_FP_SCALING_FACTOR.div(10**9));
        require(params.startingTokenPrice <= UINT_FP_SCALING_FACTOR.mul(10**9));

        // TODO(mrice32): we should have an ideal start time rather than blindly polling.
        (uint latestTime, int latestUnderlyingPrice) = s.externalAddresses.priceFeed.latestPrice(
            s.fixedParameters.product);

        // If nonzero, take the user input as the starting price.
        if (params.startingUnderlyingPrice != 0) {
            latestUnderlyingPrice = _safeIntCast(params.startingUnderlyingPrice);
        }

        require(latestUnderlyingPrice > 0);
        require(latestTime != 0);

        // Keep the ratio in case it's needed for margin computation.
        s.fixedParameters.initialTokenUnderlyingRatio = params.startingTokenPrice.mul(
            UINT_FP_SCALING_FACTOR).div(_safeUintCast(latestUnderlyingPrice));
        require(s.fixedParameters.initialTokenUnderlyingRatio != 0);

        // Set end time to max value of uint to implement no expiry.
        if (params.expiry == 0) {
            s.endTime = ~uint(0);
        } else {
            require(params.expiry >= latestTime);
            s.endTime = params.expiry;
        }

        s.nav = s._computeInitialNav(latestUnderlyingPrice, latestTime, params.startingTokenPrice);

        s.state = TDS.State.Live;
    }

    function _calcNewTokenStateAndBalance(TDS.Storage storage s)
        internal
        view
        returns (TDS.TokenState memory newTokenState, int newShortMarginBalance)
    {
        // TODO: there's a lot of repeated logic in this method from elsewhere in the contract. It should be extracted
        // so the logic can be written once and used twice. However, much of this was written post-audit, so it was
        // deemed preferable not to modify any state changing code that could potentially introduce new security
        // bugs. This should be done before the next contract audit.

        if (s.state == TDS.State.Settled) {
            // If the contract is Settled, just return the current contract state.
            return (s.currentTokenState, s.shortBalance);
        }

        // Grab the price feed pricetime.
        (uint priceFeedTime, int priceFeedPrice) = s._getLatestPrice();

        bool isContractLive = s.state == TDS.State.Live;
        bool isContractPostExpiry = priceFeedTime >= s.endTime;

        // If the time hasn't advanced since the last remargin, short circuit and return the most recently computed
        // values.
        if (isContractLive && priceFeedTime <= s.currentTokenState.time) {
            return (s.currentTokenState, s.shortBalance);
        }

        // Determine which previous price state to use when computing the new NAV.
        // If the contract is live, we use the reference for the linear return type or if the contract will immediately
        // move to expiry. 
        bool shouldUseReferenceTokenState = isContractLive &&
            (s.fixedParameters.returnType == TokenizedDerivativeParams.ReturnType.Linear || isContractPostExpiry);
        TDS.TokenState memory lastTokenState = (shouldUseReferenceTokenState ?
            s.referenceTokenState : s.currentTokenState);

        // Use the oracle settlement price/time if the contract is frozen or will move to expiry on the next remargin.
        (uint recomputeTime, int recomputePrice) = !isContractLive || isContractPostExpiry ?
            (s.endTime, s.externalAddresses.oracle.getPrice(s.fixedParameters.product, s.endTime)) :
            (priceFeedTime, priceFeedPrice);

        // Init the returned short balance to the current short balance.
        newShortMarginBalance = s.shortBalance;

        // Subtract the oracle fees from the short balance.
        newShortMarginBalance = isContractLive ?
            newShortMarginBalance.sub(
                _safeIntCast(s._computeExpectedOracleFees(s.currentTokenState.time, recomputeTime))) :
            newShortMarginBalance;

        // Compute the new NAV
        newTokenState = s._computeNewTokenState(lastTokenState, recomputePrice, recomputeTime);
        int navNew = _computeNavForTokens(newTokenState.tokenPrice, _totalSupply());
        newShortMarginBalance = newShortMarginBalance.sub(_getLongDiff(navNew, s.longBalance, newShortMarginBalance));

        // If the contract is frozen or will move into expiry, we need to settle it, which means adding the default
        // penalty and dispute deposit if necessary.
        if (!isContractLive || isContractPostExpiry) {
            // Subtract default penalty (if necessary) from the short balance.
            bool inDefault = !s._satisfiesMarginRequirement(newShortMarginBalance, newTokenState);
            if (inDefault) {
                int expectedDefaultPenalty = isContractLive ? s._computeDefaultPenalty() : s._getDefaultPenalty();
                int defaultPenalty = (newShortMarginBalance < expectedDefaultPenalty) ?
                    newShortMarginBalance :
                    expectedDefaultPenalty;
                newShortMarginBalance = newShortMarginBalance.sub(defaultPenalty);
            }

            // Add the dispute deposit to the short balance if necessary.
            if (s.state == TDS.State.Disputed && navNew != s.disputeInfo.disputedNav) {
                int depositValue = _safeIntCast(s.disputeInfo.deposit);
                newShortMarginBalance = newShortMarginBalance.add(depositValue);
            }
        }
    }

    function _computeInitialNav(
        TDS.Storage storage s,
        int latestUnderlyingPrice,
        uint latestTime,
        uint startingTokenPrice
    )
        internal
        returns (int navNew)
    {
        int unitNav = _safeIntCast(startingTokenPrice);
        s.referenceTokenState = TDS.TokenState(latestUnderlyingPrice, unitNav, latestTime);
        s.currentTokenState = TDS.TokenState(latestUnderlyingPrice, unitNav, latestTime);
        // Starting NAV is always 0 in the TokenizedDerivative case.
        navNew = 0;
    }

    function _setExternalAddresses(TDS.Storage storage s, TokenizedDerivativeParams.ConstructorParams memory params)
        internal
    {
        // Note: not all "ERC20" tokens conform exactly to this interface (BNB, OMG, etc). The most common way that
        // tokens fail to conform is that they do not return a bool from certain state-changing operations. This
        // contract was not designed to work with those tokens because of the additional complexity they would
        // introduce.
        s.externalAddresses.marginCurrency = IERC20(params.marginCurrency);

        s.externalAddresses.oracle = OracleInterface(params.oracle);
        s.externalAddresses.store = StoreInterface(params.store);
        s.externalAddresses.priceFeed = PriceFeedInterface(params.priceFeed);
        s.externalAddresses.returnCalculator = ReturnCalculatorInterface(params.returnCalculator);

        // Verify that the price feed and s.externalAddresses.oracle support the given s.fixedParameters.product.
        require(s.externalAddresses.oracle.isIdentifierSupported(params.product));
        require(s.externalAddresses.priceFeed.isIdentifierSupported(params.product));

        s.externalAddresses.sponsor = params.sponsor;
        s.externalAddresses.admin = params.admin;
    }

    function _setFixedParameters(
        TDS.Storage storage s,
        TokenizedDerivativeParams.ConstructorParams memory params,
        string memory symbol
    )
        internal
    {
        // Ensure only valid enum values are provided.
        require(params.returnType == TokenizedDerivativeParams.ReturnType.Compound
            || params.returnType == TokenizedDerivativeParams.ReturnType.Linear);

        // Fee must be 0 if the returnType is linear.
        require(params.returnType == TokenizedDerivativeParams.ReturnType.Compound || params.fixedYearlyFee == 0);

        // The default penalty must be less than the required margin.
        require(params.defaultPenalty <= UINT_FP_SCALING_FACTOR);

        s.fixedParameters.returnType = params.returnType;
        s.fixedParameters.defaultPenalty = params.defaultPenalty;
        s.fixedParameters.product = params.product;
        s.fixedParameters.fixedFeePerSecond = params.fixedYearlyFee.div(SECONDS_PER_YEAR);
        s.fixedParameters.disputeDeposit = params.disputeDeposit;
        s.fixedParameters.supportedMove = params.supportedMove;
        s.fixedParameters.withdrawLimit = params.withdrawLimit;
        s.fixedParameters.creationTime = params.creationTime;
        s.fixedParameters.symbol = symbol;
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

        // Save the penalty using the current state in case it needs to be used.
        int potentialPenaltyAmount = s._computeDefaultPenalty();

        if (latestTime >= s.endTime) {
            s.state = TDS.State.Expired;
            emit Expired(s.fixedParameters.symbol, s.endTime);

            // Applies the same update a second time to effectively move the current state to the reference state.
            int recomputedNav = s._computeNav(s.currentTokenState.underlyingPrice, s.currentTokenState.time);
            assert(recomputedNav == s.nav);

            uint feeAmount = s._deductOracleFees(s.currentTokenState.time, s.endTime);

            // Save the precomputed default penalty in case the expiry price pushes the sponsor into default.
            s.defaultPenaltyAmount = potentialPenaltyAmount;

            // We have no idea what the price was, exactly at s.endTime, so we can't set
            // s.currentTokenState, or update the nav, or do anything.
            s._requestOraclePrice(s.endTime);
            s._payOracleFees(feeAmount);
            return;
        }
        uint feeAmount = s._deductOracleFees(s.currentTokenState.time, latestTime);

        // Update nav of contract.
        int navNew = s._computeNav(latestPrice, latestTime);

        // Update the balances of the contract.
        s._updateBalances(navNew);

        // Make sure contract has not moved into default.
        bool inDefault = !s._satisfiesMarginRequirement(s.shortBalance, s.currentTokenState);
        if (inDefault) {
            s.state = TDS.State.Defaulted;
            s.defaultPenaltyAmount = potentialPenaltyAmount;
            s.endTime = latestTime; // Change end time to moment when default occurred.
            emit Default(s.fixedParameters.symbol, latestTime, s.nav);
            s._requestOraclePrice(latestTime);
        }

        s._payOracleFees(feeAmount);
    }

    function _createTokensInternal(TDS.Storage storage s, uint tokensToPurchase, uint navSent)
        internal
        returns (uint refund)
    {
        s._remarginInternal();

        // Verify that remargining didn't push the contract into expiry or default.
        require(s.state == TDS.State.Live);

        int purchasedNav = _computeNavForTokens(s.currentTokenState.tokenPrice, tokensToPurchase);

        if (purchasedNav < 0) {
            purchasedNav = 0;
        }

        // Ensures that requiredNav >= navSent.
        refund = navSent.sub(_safeUintCast(purchasedNav));

        s.longBalance = s.longBalance.add(purchasedNav);

        ExpandedIERC20 thisErc20Token = ExpandedIERC20(address(this));

        thisErc20Token.mint(msg.sender, tokensToPurchase);
        emit TokensCreated(s.fixedParameters.symbol, tokensToPurchase);

        s.nav = _computeNavForTokens(s.currentTokenState.tokenPrice, _totalSupply());

        // Make sure this still satisfies the margin requirement.
        require(s._satisfiesMarginRequirement(s.shortBalance, s.currentTokenState));
    }

    function _depositInternal(TDS.Storage storage s, uint value) internal {
        // Make sure that we are in a "depositable" state.
        require(s.state == TDS.State.Live);
        s.shortBalance = s.shortBalance.add(_safeIntCast(value));
        emit Deposited(s.fixedParameters.symbol, value);
    }

    function _settleInternal(TDS.Storage storage s) internal {
        TDS.State startingState = s.state;
        require(startingState == TDS.State.Disputed || startingState == TDS.State.Expired
                || startingState == TDS.State.Defaulted || startingState == TDS.State.Emergency);
        s._settleVerifiedPrice();
        if (startingState == TDS.State.Disputed) {
            int depositValue = _safeIntCast(s.disputeInfo.deposit);
            if (s.nav != s.disputeInfo.disputedNav) {
                s.shortBalance = s.shortBalance.add(depositValue);
            } else {
                s.longBalance = s.longBalance.add(depositValue);
            }
        }
    }

    // Deducts the fees from the margin account.
    function _deductOracleFees(TDS.Storage storage s, uint lastTimeOracleFeesPaid, uint currentTime)
        internal
        returns (uint feeAmount)
    {
        feeAmount = s._computeExpectedOracleFees(lastTimeOracleFeesPaid, currentTime);
        s.shortBalance = s.shortBalance.sub(_safeIntCast(feeAmount));
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

    function _computeExpectedOracleFees(TDS.Storage storage s, uint lastTimeOracleFeesPaid, uint currentTime)
        internal
        view
        returns (uint feeAmount)
    {
        // The profit from corruption is set as the max(longBalance, shortBalance).
        int pfc = s.shortBalance < s.longBalance ? s.longBalance : s.shortBalance;
        uint expectedFeeAmount = s.externalAddresses.store.computeOracleFees(
            lastTimeOracleFeesPaid,
            currentTime,
            _safeUintCast(pfc)
        );

        // Ensure the fee returned can actually be paid by the short margin account.
        uint shortBalance = _safeUintCast(s.shortBalance);
        return (shortBalance < expectedFeeAmount) ? shortBalance : expectedFeeAmount;
    }

    function _computeNewTokenState(TDS.Storage storage s,
        TDS.TokenState memory beginningTokenState, int latestUnderlyingPrice, uint recomputeTime)
        internal
        view
        returns (TDS.TokenState memory newTokenState)
    {
        int underlyingReturn = s.externalAddresses.returnCalculator.computeReturn(
            beginningTokenState.underlyingPrice, latestUnderlyingPrice);
        int tokenReturn = underlyingReturn.sub(
            _safeIntCast(s.fixedParameters.fixedFeePerSecond.mul(recomputeTime.sub(beginningTokenState.time))));
        int tokenMultiplier = tokenReturn.add(INT_FP_SCALING_FACTOR);
        
        // In the compound case, don't allow the token price to go below 0.
        if (s.fixedParameters.returnType == TokenizedDerivativeParams.ReturnType.Compound && tokenMultiplier < 0) {
            tokenMultiplier = 0;
        }

        int newTokenPrice = _takePercentage(beginningTokenState.tokenPrice, tokenMultiplier);
        newTokenState = TDS.TokenState(latestUnderlyingPrice, newTokenPrice, recomputeTime);
    }

    function _satisfiesMarginRequirement(TDS.Storage storage s, int balance, TDS.TokenState memory tokenState)
        internal
        view
        returns (bool doesSatisfyRequirement) 
    {
        return s._getRequiredMargin(tokenState) <= balance;
    }

    function _requestOraclePrice(TDS.Storage storage s, uint requestedTime) internal {
        uint expectedTime = s.externalAddresses.oracle.requestPrice(s.fixedParameters.product, requestedTime);
        if (expectedTime == 0) {
            // The Oracle price is already available, settle the contract right away.
            s._settleInternal();
        }
    }

    function _getLatestPrice(TDS.Storage storage s) internal view returns (uint latestTime, int latestUnderlyingPrice) {
        (latestTime, latestUnderlyingPrice) = s.externalAddresses.priceFeed.latestPrice(s.fixedParameters.product);
        require(latestTime != 0);
    }

    function _computeNav(TDS.Storage storage s, int latestUnderlyingPrice, uint latestTime)
        internal
        returns (int navNew)
    {
        if (s.fixedParameters.returnType == TokenizedDerivativeParams.ReturnType.Compound) {
            navNew = s._computeCompoundNav(latestUnderlyingPrice, latestTime);
        } else {
            assert(s.fixedParameters.returnType == TokenizedDerivativeParams.ReturnType.Linear);
            navNew = s._computeLinearNav(latestUnderlyingPrice, latestTime);
        }
    }

    function _computeCompoundNav(TDS.Storage storage s, int latestUnderlyingPrice, uint latestTime)
        internal
        returns (int navNew)
    {
        s.referenceTokenState = s.currentTokenState;
        s.currentTokenState = s._computeNewTokenState(s.currentTokenState, latestUnderlyingPrice, latestTime);
        navNew = _computeNavForTokens(s.currentTokenState.tokenPrice, _totalSupply());
        emit NavUpdated(s.fixedParameters.symbol, navNew, s.currentTokenState.tokenPrice);
    }

    function _computeLinearNav(TDS.Storage storage s, int latestUnderlyingPrice, uint latestTime)
        internal
        returns (int navNew)
    {
        // Only update the time - don't update the prices becuase all price changes are relative to the initial price.
        s.referenceTokenState.time = s.currentTokenState.time;
        s.currentTokenState = s._computeNewTokenState(s.referenceTokenState, latestUnderlyingPrice, latestTime);
        navNew = _computeNavForTokens(s.currentTokenState.tokenPrice, _totalSupply());
        emit NavUpdated(s.fixedParameters.symbol, navNew, s.currentTokenState.tokenPrice);
    }

    function _recomputeNav(TDS.Storage storage s, int oraclePrice, uint recomputeTime) internal returns (int navNew) {
        // We're updating `last` based on what the Oracle has told us.
        assert(s.endTime == recomputeTime);
        s.currentTokenState = s._computeNewTokenState(s.referenceTokenState, oraclePrice, recomputeTime);
        navNew = _computeNavForTokens(s.currentTokenState.tokenPrice, _totalSupply());
        emit NavUpdated(s.fixedParameters.symbol, navNew, s.currentTokenState.tokenPrice);
    }

    // Function is internally only called by `_settleAgreedPrice` or `_settleVerifiedPrice`. This function handles all 
    // of the settlement logic including assessing penalties and then moves the state to `Settled`.
    function _settleWithPrice(TDS.Storage storage s, int price) internal {

        // Remargin at whatever price we're using (verified or unverified).
        s._updateBalances(s._recomputeNav(price, s.endTime));

        bool inDefault = !s._satisfiesMarginRequirement(s.shortBalance, s.currentTokenState);

        if (inDefault) {
            int expectedDefaultPenalty = s._getDefaultPenalty();
            int penalty = (s.shortBalance < expectedDefaultPenalty) ?
                s.shortBalance :
                expectedDefaultPenalty;

            s.shortBalance = s.shortBalance.sub(penalty);
            s.longBalance = s.longBalance.add(penalty);
        }

        s.state = TDS.State.Settled;
        emit Settled(s.fixedParameters.symbol, s.endTime, s.nav);
    }

    function _updateBalances(TDS.Storage storage s, int navNew) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update nav state variable.
        int longDiff = _getLongDiff(navNew, s.longBalance, s.shortBalance);
        s.nav = navNew;

        s.longBalance = s.longBalance.add(longDiff);
        s.shortBalance = s.shortBalance.sub(longDiff);
    }

    function _getDefaultPenalty(TDS.Storage storage s) internal view returns (int penalty) {
        return s.defaultPenaltyAmount;
    }

    function _computeDefaultPenalty(TDS.Storage storage s) internal view returns (int penalty) {
        return _takePercentage(s._getRequiredMargin(s.currentTokenState), s.fixedParameters.defaultPenalty);
    }

    function _getRequiredMargin(TDS.Storage storage s, TDS.TokenState memory tokenState)
        internal
        view
        returns (int requiredMargin)
    {
        int leverageMagnitude = _absoluteValue(s.externalAddresses.returnCalculator.leverage());

        int effectiveNotional;
        if (s.fixedParameters.returnType == TokenizedDerivativeParams.ReturnType.Linear) {
            int effectiveUnitsOfUnderlying = _safeIntCast(_totalSupply().mul(
                s.fixedParameters.initialTokenUnderlyingRatio).div(UINT_FP_SCALING_FACTOR)).mul(leverageMagnitude);
            effectiveNotional = effectiveUnitsOfUnderlying.mul(tokenState.underlyingPrice).div(INT_FP_SCALING_FACTOR);
        } else {
            int currentNav = _computeNavForTokens(tokenState.tokenPrice, _totalSupply());
            effectiveNotional = currentNav.mul(leverageMagnitude);
        }

        // Take the absolute value of the notional since a negative notional has similar risk properties to a positive
        // notional of the same size, and, therefore, requires the same margin.
        requiredMargin = _takePercentage(_absoluteValue(effectiveNotional), s.fixedParameters.supportedMove);
    }

    function _pullSentMargin(TDS.Storage storage s, uint expectedMargin) internal returns (uint refund) {
        if (address(s.externalAddresses.marginCurrency) == address(0x0)) {
            // Refund is any amount of ETH that was sent that was above the amount that was expected.
            // Note: SafeMath will force a revert if msg.value < expectedMargin.
            return msg.value.sub(expectedMargin);
        } else {
            // If we expect an ERC20 token, no ETH should be sent.
            require(msg.value == 0);
            _pullAuthorizedTokens(s.externalAddresses.marginCurrency, expectedMargin);

            // There is never a refund in the ERC20 case since we use the argument to determine how much to "pull".
            return 0;
        }
    }

    function _sendMargin(TDS.Storage storage s, uint amount) internal {
        // There's no point in attempting a send if there's nothing to send.
        if (amount == 0) {
            return;
        }

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

    function _pullAuthorizedTokens(IERC20 erc20, uint amountToPull) private {
        // If nothing is being pulled, there's no point in calling a transfer.
        if (amountToPull > 0) {
            require(erc20.transferFrom(msg.sender, address(this), amountToPull));
        }
    }

    // Gets the change in balance for the long side.
    // Note: there's a function for this because signage is tricky here, and it must be done the same everywhere.
    function _getLongDiff(int navNew, int longBalance, int shortBalance) private pure returns (int longDiff) {
        int newLongBalance = navNew;

        // Long balance cannot go below zero.
        if (newLongBalance < 0) {
            newLongBalance = 0;
        }

        longDiff = newLongBalance.sub(longBalance);

        // Cannot pull more margin from the short than is available.
        if (longDiff > shortBalance) {
            longDiff = shortBalance;
        }
    }

    function _computeNavForTokens(int tokenPrice, uint numTokens) private pure returns (int navNew) {
        int navPreDivision = _safeIntCast(numTokens).mul(tokenPrice);
        navNew = navPreDivision.div(INT_FP_SCALING_FACTOR);

        // The navNew division above truncates by default. Instead, we prefer to ceil this value to ensure tokens
        // cannot be purchased or backed with less than their true value.
        if ((navPreDivision % INT_FP_SCALING_FACTOR) != 0) {
            navNew = navNew.add(1);
        }
    }

    function _totalSupply() private view returns (uint totalSupply) {
        ExpandedIERC20 thisErc20Token = ExpandedIERC20(address(this));
        return thisErc20Token.totalSupply();
    }

    function _takePercentage(uint value, uint percentage) private pure returns (uint result) {
        return value.mul(percentage).div(UINT_FP_SCALING_FACTOR);
    }

    function _takePercentage(int value, uint percentage) private pure returns (int result) {
        return value.mul(_safeIntCast(percentage)).div(INT_FP_SCALING_FACTOR);
    }

    function _takePercentage(int value, int percentage) private pure returns (int result) {
        return value.mul(percentage).div(INT_FP_SCALING_FACTOR);
    }

    function _absoluteValue(int value) private pure returns (int result) {
        return value < 0 ? value.mul(-1) : value;
    }

    function _safeIntCast(uint value) private pure returns (int result) {
        require(value <= INT_MAX);
        return int(value);
    }

    function _safeUintCast(int value) private pure returns (uint result) {
        require(value >= 0);
        return uint(value);
    }

    // Note that we can't have the symbol parameter be `indexed` due to:
    // TypeError: Indexed reference types cannot yet be used with ABIEncoderV2.
    // An event emitted when the NAV of the contract changes.
    event NavUpdated(string symbol, int newNav, int newTokenPrice);
    // An event emitted when the contract enters the Default state on a remargin.
    event Default(string symbol, uint defaultTime, int defaultNav);
    // An event emitted when the contract settles.
    event Settled(string symbol, uint settleTime, int finalNav);
    // An event emitted when the contract expires.
    event Expired(string symbol, uint expiryTime);
    // An event emitted when the contract's NAV is disputed by the sponsor.
    event Disputed(string symbol, uint timeDisputed, int navDisputed);
    // An event emitted when the contract enters emergency shutdown.
    event EmergencyShutdownTransition(string symbol, uint shutdownTime);
    // An event emitted when tokens are created.
    event TokensCreated(string symbol, uint numTokensCreated);
    // An event emitted when tokens are redeemed.
    event TokensRedeemed(string symbol, uint numTokensRedeemed);
    // An event emitted when margin currency is deposited.
    event Deposited(string symbol, uint amount);
    // An event emitted when margin currency is withdrawn.
    event Withdrawal(string symbol, uint amount);
}


// TODO(mrice32): make this and TotalReturnSwap derived classes of a single base to encap common functionality.
contract TokenizedDerivative is ERC20, AdminInterface, ExpandedIERC20 {
    using TokenizedDerivativeUtils for TDS.Storage;

    // Note: these variables are to give ERC20 consumers information about the token.
    string public name;
    string public symbol;
    uint8 public constant decimals = 18; // solhint-disable-line const-name-snakecase

    TDS.Storage public derivativeStorage;

    constructor(
        TokenizedDerivativeParams.ConstructorParams memory params,
        string memory _name,
        string memory _symbol
    ) public {
        // Set token properties.
        name = _name;
        symbol = _symbol;

        // Initialize the contract.
        derivativeStorage._initialize(params, _symbol);
    }

    // Creates tokens with sent margin and returns additional margin.
    function createTokens(uint marginForPurchase, uint tokensToPurchase) external payable {
        derivativeStorage._createTokens(marginForPurchase, tokensToPurchase);
    }

    // Creates tokens with sent margin and deposits additional margin in short account.
    function depositAndCreateTokens(uint marginForPurchase, uint tokensToPurchase) external payable {
        derivativeStorage._depositAndCreateTokens(marginForPurchase, tokensToPurchase);
    }

    // Redeems tokens for margin currency.
    function redeemTokens(uint tokensToRedeem) external {
        derivativeStorage._redeemTokens(tokensToRedeem);
    }

    // Triggers a price dispute for the most recent remargin time.
    function dispute(uint depositMargin) external payable {
        derivativeStorage._dispute(depositMargin);
    }

    // Withdraws `amount` from short margin account.
    function withdraw(uint amount) external {
        derivativeStorage._withdraw(amount);
    }

    // Pays (Oracle and service) fees for the previous period, updates the contract NAV, moves margin between long and
    // short accounts to reflect the new NAV, and checks if both accounts meet minimum requirements.
    function remargin() external {
        derivativeStorage._remargin();
    }

    // Forgo the Oracle verified price and settle the contract with last remargin price. This method is only callable on
    // contracts in the `Defaulted` state, and the default penalty is always transferred from the short to the long
    // account.
    function acceptPriceAndSettle() external {
        derivativeStorage._acceptPriceAndSettle();
    }

    // Assigns an address to be the contract's Delegate AP. Replaces previous value. Set to 0x0 to indicate there is no
    // Delegate AP.
    function setApDelegate(address apDelegate) external {
        derivativeStorage._setApDelegate(apDelegate);
    }

    // Moves the contract into the Emergency state, where it waits on an Oracle price for the most recent remargin time.
    function emergencyShutdown() external {
        derivativeStorage._emergencyShutdown();
    }

    // When an Oracle price becomes available, performs a final remargin, assesses any penalties, and moves the contract
    // into the `Settled` state.
    function settle() external {
        derivativeStorage._settle();
    }

    // Adds the margin sent along with the call (or in the case of an ERC20 margin currency, authorized before the call)
    // to the short account.
    function deposit(uint amountToDeposit) external payable {
        derivativeStorage._deposit(amountToDeposit);
    }

    // Allows the sponsor to withdraw any ERC20 balance that is not the margin token.
    function withdrawUnexpectedErc20(address erc20Address, uint amount) external {
        derivativeStorage._withdrawUnexpectedErc20(erc20Address, amount);
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

    // Returns the required margin, as of the last remargin. Note that `calcExcessMargin` uses updated values using the
    // latest available Price Feed price.
    function getCurrentRequiredMargin() external view returns (int requiredMargin) {
        return derivativeStorage._getCurrentRequiredMargin();
    }

    // Returns whether the contract can be settled, i.e., is it valid to call settle() now.
    function canBeSettled() external view returns (bool canContractBeSettled) {
        return derivativeStorage._canBeSettled();
    }

    // Returns the updated underlying price that was used in the calc* methods above. It will be a price feed price if
    // the contract is Live and will remain Live, or an Oracle price if the contract is settled/about to be settled.
    // Reverts if no Oracle price is available but an Oracle price is required.
    function getUpdatedUnderlyingPrice() external view returns (int underlyingPrice, uint time) {
        return derivativeStorage._getUpdatedUnderlyingPrice();
    }

    // These events are actually emitted by TokenizedDerivativeUtils, but we unfortunately have to define the events
    // here as well.
    event NavUpdated(string symbol, int newNav, int newTokenPrice);
    event Default(string symbol, uint defaultTime, int defaultNav);
    event Settled(string symbol, uint settleTime, int finalNav);
    event Expired(string symbol, uint expiryTime);
    event Disputed(string symbol, uint timeDisputed, int navDisputed);
    event EmergencyShutdownTransition(string symbol, uint shutdownTime);
    event TokensCreated(string symbol, uint numTokensCreated);
    event TokensRedeemed(string symbol, uint numTokensRedeemed);
    event Deposited(string symbol, uint amount);
    event Withdrawal(string symbol, uint amount);
}


contract TokenizedDerivativeCreator is ContractCreator, Testable {
    struct Params {
        uint defaultPenalty; // Percentage of mergin requirement * 10^18
        uint supportedMove; // Expected percentage move in the underlying that the long is protected against.
        bytes32 product;
        uint fixedYearlyFee; // Percentage of nav * 10^18
        uint disputeDeposit; // Percentage of mergin requirement * 10^18
        address returnCalculator;
        uint startingTokenPrice;
        uint expiry;
        address marginCurrency;
        uint withdrawLimit; // Percentage of shortBalance * 10^18
        TokenizedDerivativeParams.ReturnType returnType;
        uint startingUnderlyingPrice;
        string name;
        string symbol;
    }

    AddressWhitelist public sponsorWhitelist;
    AddressWhitelist public returnCalculatorWhitelist;
    AddressWhitelist public marginCurrencyWhitelist;

    constructor(
        address registryAddress,
        address _oracleAddress,
        address _storeAddress,
        address _priceFeedAddress,
        address _sponsorWhitelist,
        address _returnCalculatorWhitelist,
        address _marginCurrencyWhitelist,
        bool _isTest
    ) public ContractCreator(registryAddress, _oracleAddress, _storeAddress, _priceFeedAddress) Testable(_isTest) {
        sponsorWhitelist = AddressWhitelist(_sponsorWhitelist);
        returnCalculatorWhitelist = AddressWhitelist(_returnCalculatorWhitelist);
        marginCurrencyWhitelist = AddressWhitelist(_marginCurrencyWhitelist);
    }

    function createTokenizedDerivative(Params memory params)
        public
        returns (address derivativeAddress)
    {
        TokenizedDerivative derivative = new TokenizedDerivative(_convertParams(params), params.name, params.symbol);

        address[] memory parties = new address[](1);
        parties[0] = msg.sender;

        _registerContract(parties, address(derivative));

        return address(derivative);
    }

    // Converts createTokenizedDerivative params to TokenizedDerivative constructor params.
    function _convertParams(Params memory params)
        private
        view
        returns (TokenizedDerivativeParams.ConstructorParams memory constructorParams)
    {
        // Copy and verify externally provided variables.
        require(sponsorWhitelist.isOnWhitelist(msg.sender));
        constructorParams.sponsor = msg.sender;

        require(returnCalculatorWhitelist.isOnWhitelist(params.returnCalculator));
        constructorParams.returnCalculator = params.returnCalculator;

        require(marginCurrencyWhitelist.isOnWhitelist(params.marginCurrency));
        constructorParams.marginCurrency = params.marginCurrency;

        constructorParams.defaultPenalty = params.defaultPenalty;
        constructorParams.supportedMove = params.supportedMove;
        constructorParams.product = params.product;
        constructorParams.fixedYearlyFee = params.fixedYearlyFee;
        constructorParams.disputeDeposit = params.disputeDeposit;
        constructorParams.startingTokenPrice = params.startingTokenPrice;
        constructorParams.expiry = params.expiry;
        constructorParams.withdrawLimit = params.withdrawLimit;
        constructorParams.returnType = params.returnType;
        constructorParams.startingUnderlyingPrice = params.startingUnderlyingPrice;

        // Copy internal variables.
        constructorParams.priceFeed = priceFeedAddress;
        constructorParams.oracle = oracleAddress;
        constructorParams.store = storeAddress;
        constructorParams.admin = oracleAddress;
        constructorParams.creationTime = getCurrentTime();
    }
}
