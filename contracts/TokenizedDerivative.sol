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
        uint defaultPenalty; // Percentage of nav * 10^18
        uint requiredMargin; // Percentage of nav * 10^18
        bytes32 product;
        uint fixedYearlyFee; // Percentage of nav * 10^18
        uint disputeDeposit; // Percentage of nav * 10^18
        address returnCalculator;
        uint startingTokenPrice;
        uint expiry;
        address marginCurrency;
        uint withdrawLimit; // Percentage of shortBalance * 10^18
    }
}


// TODO(mrice32): make this and TotalReturnSwap derived classes of a single base to encap common functionality.
contract TokenizedDerivative is ERC20, AdminInterface {
    using SafeMath for uint;
    using SignedSafeMath for int;

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

    // Note: these variables are to give ERC20 consumers information about the token.
    string public constant name = "2x Levered Bitcoin-Ether"; // solhint-disable-line const-name-snakecase
    string public constant symbol = "2XBCE"; // solhint-disable-line const-name-snakecase
    uint8 public constant decimals = 18; // solhint-disable-line const-name-snakecase

    // Fixed contract parameters.
    uint public defaultPenalty; // Percentage of nav*10^18
    uint public marginRequirement; // Percentage of nav*10^18
    uint public disputeDeposit; // Percentage of nav*10^18
    uint public fixedFeePerSecond; // Percentage of nav*10^18
    uint public withdrawLimit; // Percentage of shortBalance*10^18
    bytes32 public product;

    // Balances
    int public shortBalance;
    int public longBalance;

    // Other addresses/contracts
    address public sponsor;
    address public admin;
    address public apDelegate;
    OracleInterface public oracle;
    StoreInterface public store;
    PriceFeedInterface public priceFeed;
    ReturnCalculatorInterface public returnCalculator;
    IERC20 public marginCurrency;

    State public state;
    uint public endTime;

    // The state of the token at a particular time. The state gets updated on remargin.
    struct TokenState {
        int underlyingPrice;
        int tokenPrice;
        uint time;
    }

    // The NAV of the contract always reflects the transition from (`prev`, `current`).
    // In the case of a remargin, a `latest` price is retrieved from the price feed, and we shift `current` -> `prev`
    // and `latest` -> `current` (and then recompute).
    // In the case of a dispute, `current` might change (which is why we have to hold on to `prev`).
    TokenState public prevTokenState;
    TokenState public currentTokenState;

    int public nav;  // Net asset value is measured in Wei

    // The information in the following struct is only valid if in the midst of a Dispute.
    struct Dispute {
        int disputedNav;
        uint deposit;
    }

    Dispute public disputeInfo;

    // Only valid if in the midst of a Default.
    int public navAtDefault;

    uint private constant SECONDS_PER_YEAR = 31536000;
    uint private constant SECONDS_PER_DAY = 86400;

    struct WithdrawThrottle {
        uint startTime;
        uint remainingWithdrawal;
    }

    WithdrawThrottle public withdrawThrottle;

    modifier onlySponsor {
        require(msg.sender == sponsor);
        _;
    }

    modifier onlyAdmin {
        require(msg.sender == admin);
        _;
    }

    modifier onlySponsorOrAdmin {
        require(msg.sender == sponsor || msg.sender == admin);
        _;
    }

    modifier onlySponsorOrApDelegate {
        require(msg.sender == sponsor || msg.sender == apDelegate);
        _;
    }

    constructor(
        TokenizedDerivativeParams.ConstructorParams memory params
    ) public payable {
        // The default penalty must be less than the required margin, which must be less than the NAV.
        require(params.defaultPenalty <= params.requiredMargin);
        require(params.requiredMargin <= 1 ether);
        marginRequirement = params.requiredMargin;

        marginCurrency = IERC20(params.marginCurrency);
        
        // Keep the starting token price relatively close to 1 ether to prevent users from unintentionally creating
        // rounding or overflow errors.
        require(params.startingTokenPrice >= uint(1 ether).div(10**9));
        require(params.startingTokenPrice <= uint(1 ether).mul(10**9));

        // Address information
        oracle = OracleInterface(params.oracle);
        store = StoreInterface(params.store);
        priceFeed = PriceFeedInterface(params.priceFeed);
        // Verify that the price feed and oracle support the given product.
        require(oracle.isIdentifierSupported(params.product));
        require(priceFeed.isIdentifierSupported(params.product));

        sponsor = params.sponsor;
        admin = params.admin;
        returnCalculator = ReturnCalculatorInterface(params.returnCalculator);

        // Contract parameters.
        defaultPenalty = params.defaultPenalty;
        product = params.product;
        fixedFeePerSecond = params.fixedYearlyFee.div(SECONDS_PER_YEAR);
        disputeDeposit = params.disputeDeposit;

        // TODO(mrice32): we should have an ideal start time rather than blindly polling.
        (uint latestTime, int latestUnderlyingPrice) = priceFeed.latestPrice(product);
        require(latestTime != 0);

        // Set end time to max value of uint to implement no expiry.
        if (params.expiry == 0) {
            endTime = ~uint(0);
        } else {
            require(params.expiry >= latestTime);
            endTime = params.expiry;
        }

        nav = _computeInitialNav(latestUnderlyingPrice, latestTime, params.startingTokenPrice);

        state = State.Live;

        require(params.withdrawLimit < 1 ether);
        withdrawLimit = params.withdrawLimit;
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
        require(state == State.Live || state == State.Settled);

        if (state == State.Live) {
            require(msg.sender == sponsor || msg.sender == apDelegate);
            _remargin();
        }

        uint initialSupply = totalSupply();

        uint numTokens = _pullAllAuthorizedTokens(this);
        require(numTokens > 0);
        _burn(address(this), numTokens);

        // Value of the tokens is just the percentage of all the tokens multiplied by the balance of the investor
        // margin account.
        assert(longBalance >= 0);
        uint tokenPercentage = numTokens.mul(1 ether).div(initialSupply);
        uint tokenValue = _takePercentage(uint(longBalance), tokenPercentage);

        longBalance = longBalance.sub(int(tokenValue));
        nav = _computeNavFromTokenPrice(currentTokenState.tokenPrice);

        _sendMargin(tokenValue);
    }

    function dispute() external payable onlySponsor {
        require(
            state == State.Live,
            "Contract must be Live to dispute"
        );

        uint requiredDeposit = uint(_takePercentage(nav, disputeDeposit));

        uint sentAmount = _pullSentMargin();

        require(sentAmount >= requiredDeposit);
        uint refund = sentAmount.sub(requiredDeposit);

        state = State.Disputed;
        endTime = currentTokenState.time;
        disputeInfo.disputedNav = nav;
        disputeInfo.deposit = requiredDeposit;

        _requestOraclePrice(endTime);

        _sendMargin(refund);
    }

    function withdraw(uint amount) external onlySponsor {
        // Remargin before allowing a withdrawal, but only if in the live state.
        if (state == State.Live) {
            _remargin();
        }

        // Make sure either in Live or Settled after any necessary remargin.
        require(state == State.Live || state == State.Settled);

        // If the contract has been settled or is in prefunded state then can
        // withdraw up to full balance. If the contract is in live state then
        // must leave at least `requiredMargin`. Not allowed to withdraw in
        // other states.
        int withdrawableAmount;
        if (state == State.Settled) {
            withdrawableAmount = shortBalance;
        } else {
            // Update throttling snapshot and verify that this withdrawal doesn't go past the throttle limit.
            uint currentTime = currentTokenState.time;
            if (withdrawThrottle.startTime <= currentTime.sub(SECONDS_PER_DAY)) {
                // We've passed the previous withdrawThrottle window. Start new one.
                withdrawThrottle.startTime = currentTime;
                withdrawThrottle.remainingWithdrawal = _takePercentage(uint(shortBalance), withdrawLimit);
            }

            int marginMaxWithdraw = shortBalance.sub(_getRequiredEthMargin(nav));
            int throttleMaxWithdraw = int(withdrawThrottle.remainingWithdrawal);

            // Take the smallest of the two withdrawal limits.
            withdrawableAmount = throttleMaxWithdraw < marginMaxWithdraw ? throttleMaxWithdraw : marginMaxWithdraw;

            // Note: this line alone implicitly ensures the withdrawal throttle is not violated, but the above
            // ternary is more explicit.
            withdrawThrottle.remainingWithdrawal = withdrawThrottle.remainingWithdrawal.sub(amount);
        }

        // Can only withdraw the allowed amount.
        require(
            withdrawableAmount >= int(amount),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return.
        shortBalance = shortBalance.sub(int(amount));
        _sendMargin(amount);
    }

    function remargin() external onlySponsorOrAdmin {
        _remargin();
    }

    function confirmPrice() external onlySponsor {
        // Right now, only confirming prices in the defaulted state.
        require(state == State.Defaulted);

        // Remargin on agreed upon price.
        _settleAgreedPrice();
    }

    function setApDelegate(address _apDelegate) external onlySponsor {
        apDelegate = _apDelegate;
    }

    // Moves the contract into the Emergency state, where it waits on an Oracle price for the most recent remargin time.
    function emergencyShutdown() external onlyAdmin {
        require(state == State.Live);
        state = State.Emergency;
        endTime = currentTokenState.time;
        _requestOraclePrice(endTime);
    }

    function settle() public {
        State startingState = state;
        require(startingState == State.Disputed || startingState == State.Expired
                || startingState == State.Defaulted || startingState == State.Emergency);
        _settleVerifiedPrice();
        if (startingState == State.Disputed) {
            int depositValue = int(disputeInfo.deposit);
            if (nav != disputeInfo.disputedNav) {
                shortBalance = shortBalance.add(depositValue);
            } else {
                longBalance = longBalance.add(depositValue);
            }
        }
    }

    function deposit() public payable onlySponsor {
        // Only allow the sponsor to deposit margin.
        _deposit(_pullSentMargin());
    }

    function _payOracleFees(uint lastTimeOracleFeesPaid, uint currentTime, int lastTokenNav) private {
        uint expectedFeeAmount = store.computeOracleFees(lastTimeOracleFeesPaid, currentTime, uint(lastTokenNav));
        uint feeAmount = (uint(shortBalance) < expectedFeeAmount) ? uint(shortBalance) : expectedFeeAmount;
        if (feeAmount == 0) {
            return;
        }
        shortBalance = shortBalance.sub(int(feeAmount));
        // If paying the Oracle fee reduces the held margin below requirements, the rest of remargin() will default the
        // contract.
        if (address(marginCurrency) == address(0x0)) {
            store.payOracleFees.value(feeAmount)();
        } else {
            require(marginCurrency.approve(address(store), feeAmount));
            store.payOracleFeesErc20(address(marginCurrency));
        }
    }

    function _createTokens(uint navToPurchase) private {
        _remargin();

        // Verify that remargining didn't push the contract into expiry or default.
        require(state == State.Live);

        longBalance = longBalance.add(int(navToPurchase));

        _mint(msg.sender, uint(_tokensFromNav(int(navToPurchase), currentTokenState.tokenPrice)));

        nav = _computeNavFromTokenPrice(currentTokenState.tokenPrice);

        // Make sure this still satisfies the margin requirement.
        require(_satisfiesMarginRequirement(shortBalance, nav));
    }

    function _deposit(uint value) private {
        // Make sure that we are in a "depositable" state.
        require(state == State.Live);
        shortBalance = shortBalance.add(int(value));
    }

    function _pullSentMargin() private returns (uint amount) {
        if (address(marginCurrency) == address(0x0)) {
            return msg.value;
        } else {
            // If we expect an ERC20 token, no ETH should be sent.
            require(msg.value == 0);
            return _pullAllAuthorizedTokens(marginCurrency);
        }
    }

    function _sendMargin(uint amount) private {
        if (address(marginCurrency) == address(0x0)) {
            msg.sender.transfer(amount);
        } else {
            require(marginCurrency.transfer(msg.sender, amount));
        }
    }

    function _getRequiredEthMargin(int currentNav)
        private
        view
        returns (int requiredEthMargin)
    {
        return _takePercentage(currentNav, marginRequirement);
    }

    // Function is internally only called by `_settleAgreedPrice` or `_settleVerifiedPrice`. This function handles all 
    // of the settlement logic including assessing penalties and then moves the state to `Settled`.
    function _settle(int price) private {

        // Remargin at whatever price we're using (verified or unverified).
        _updateBalances(_recomputeNav(price, endTime));

        bool inDefault = !_satisfiesMarginRequirement(shortBalance, nav);

        if (inDefault) {
            int expectedDefaultPenalty = _getDefaultPenaltyEth();
            int penalty = (shortBalance < expectedDefaultPenalty) ?
                shortBalance :
                expectedDefaultPenalty;

            shortBalance = shortBalance.sub(penalty);
            longBalance = longBalance.add(penalty);
        }

        state = State.Settled;
    }

    function _settleAgreedPrice() private {
        int agreedPrice = currentTokenState.underlyingPrice;

        _settle(agreedPrice);
    }

    function _settleVerifiedPrice() private {
        int oraclePrice = oracle.getPrice(product, endTime);
        _settle(oraclePrice);
    }

    // _remargin() allows other functions to call remargin internally without satisfying permission checks for
    // remargin().
    function _remargin() private {
        // If the state is not live, remargining does not make sense.
        require(state == State.Live);

        // Checks whether contract has ended.
        (uint latestTime, int latestPrice) = priceFeed.latestPrice(product);
        require(latestTime != 0);
        if (latestTime <= currentTokenState.time) {
            // If the price feed hasn't advanced, remargining should be a no-op.
            return;
        }
        if (latestTime >= endTime) {
            state = State.Expired;
            prevTokenState = currentTokenState;
            _payOracleFees(currentTokenState.time, endTime, nav);
            // We have no idea what the price was, exactly at endTime, so we can't set
            // currentTokenState, or update the nav, or do anything.
            _requestOraclePrice(endTime);
            return;
        }
        _payOracleFees(currentTokenState.time, latestTime, nav);

        // Update nav of contract.
        int navNew = _computeNav(latestPrice, latestTime);
        
        // Save the current NAV in case it's required to compute the default penalty.
        int previousNav = nav;

        // Update the balances of the contract.
        _updateBalances(navNew);

        // Make sure contract has not moved into default.
        bool inDefault = !_satisfiesMarginRequirement(shortBalance, nav);
        if (inDefault) {
            state = State.Defaulted;
            navAtDefault = previousNav;
            endTime = latestTime; // Change end time to moment when default occurred.
        }

        if (inDefault) {
            _requestOraclePrice(endTime);
        }
    }

    function _updateBalances(int navNew) private {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update nav state variable.
        int longDiff = _getLongNavDiff(navNew);
        nav = navNew;

        longBalance = longBalance.add(longDiff);
        shortBalance = shortBalance.sub(longDiff);
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
        return navNew.sub(nav);
    }

    function _getDefaultPenaltyEth() private view returns (int penalty) {
        return _takePercentage(navAtDefault, defaultPenalty);
    }

    function _tokensFromNav(int currentNav, int unitNav) private pure returns (int numTokens) {
        if (unitNav <= 0) {
            return 0;
        } else {
            return currentNav.mul(1 ether).div(unitNav);
        }
    }

    function calcNAV() external view returns (int navNew) {
        require(state == State.Live);

        (uint latestTime, int latestUnderlyingPrice) = priceFeed.latestPrice(product);
        require(latestTime != 0);
        require(latestTime < endTime);
        TokenState memory a = _computeNewTokenState(currentTokenState, latestUnderlyingPrice, latestTime);
        navNew = _computeNavFromTokenPrice(a.tokenPrice);
    }

    function _computeNav(int latestUnderlyingPrice, uint latestTime) private returns (int navNew) {
        prevTokenState = currentTokenState;
        currentTokenState = _computeNewTokenState(currentTokenState, latestUnderlyingPrice, latestTime);
        navNew = _computeNavFromTokenPrice(currentTokenState.tokenPrice);
    }

    function _recomputeNav(int oraclePrice, uint recomputeTime) private returns (int navNew) {
        // We're updating `last` based on what the Oracle has told us.
        // TODO(ptare): Add ability for the Oracle to correct the time as well.
        assert(endTime == recomputeTime);
        currentTokenState = _computeNewTokenState(prevTokenState, oraclePrice, recomputeTime);
        navNew = _computeNavFromTokenPrice(currentTokenState.tokenPrice);
    }

    function _computeInitialNav(int latestUnderlyingPrice, uint latestTime, uint startingTokenPrice)
        private
        returns (int navNew) {
            int unitNav = int(startingTokenPrice);
            prevTokenState = TokenState(latestUnderlyingPrice, unitNav, latestTime);
            currentTokenState = TokenState(latestUnderlyingPrice, unitNav, latestTime);
            navNew = _computeNavFromTokenPrice(unitNav);
        }

    function _requestOraclePrice(uint requestedTime) private {
        uint expectedTime = oracle.requestPrice(product, requestedTime);
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

            int underlyingReturn = returnCalculator.computeReturn(
                beginningTokenState.underlyingPrice, latestUnderlyingPrice);
            int tokenReturn = underlyingReturn.sub(
                int(fixedFeePerSecond.mul(recomputeTime.sub(beginningTokenState.time))));
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
        uint defaultPenalty; // Percentage of nav * 10^18
        uint requiredMargin; // Percentage of nav * 10^18
        bytes32 product;
        uint fixedYearlyFee; // Percentage of nav * 10^18
        uint disputeDeposit; // Percentage of nav * 10^18
        address returnCalculator;
        uint startingTokenPrice;
        uint expiry;
        address marginCurrency;
        uint withdrawLimit; // Percentage of shortBalance * 10^18
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
        TokenizedDerivative derivative = new TokenizedDerivative(_convertParams(params));

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
