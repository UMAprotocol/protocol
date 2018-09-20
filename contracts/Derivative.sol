/*
  Derivative implementation

  Implements a simplified version of ETH/USD derivatives.

  TODO: Implement tax function
*/
pragma solidity ^0.4.24;

import "installed_contracts/oraclize-api/contracts/usingOraclize.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";


// This interface allows us to get the Ethereum-USD exchange rate
contract VoteCoinInterface {
    string public ethUsd;
}


contract Derivative {

    // Note: SafeMath only works for uints right now.
    using SafeMath for uint;

    enum State {
        Prefunded,
        Live,
        Disputed,
        Expired,
        Default,
        Settled
    }

    // Financial information
    mapping(address => int256) public balances; // Stored in Wei
    int256 public defaultPenalty;  //
    int256 public requiredMargin;  //

    // Other addresses/contracts
    address public ownerAddress;          // should this be public?
    address public counterpartyAddress;   //
    VoteCoinInterface public oracle;

    State public state = State.Prefunded;
    uint public startTime;
    uint public endTime;

    int256 public npv;  // Net present value is measured in Wei

    constructor(
        address _counterpartyAddress,
        address _oracleAddress,
        uint _duration,
        int256 _defaultPenalty,
        int256 _requiredMargin
    ) public {

        // Contract states
        startTime = now; // solhint-disable-line not-rely-on-time
        endTime = startTime.add(_duration);
        defaultPenalty = _defaultPenalty;
        requiredMargin = _requiredMargin;
        npv = initialNpv();

        // Address information
        oracle = VoteCoinInterface(_oracleAddress);
        counterpartyAddress = _counterpartyAddress;
        balances[ownerAddress] = 0;
        balances[counterpartyAddress] = 0;
    }

    function remargin() public {
        // Check if time is over...
        // TODO: If the contract is expired, remargin to the NPV at expiry rather than the current NPV.
        uint currentTime = now; // solhint-disable-line not-rely-on-time
        if (currentTime > endTime) {
            state = State.Expired;
        }

        // Update npv of contract
        int256 npvNew = computeNpv();
        remargin(npvNew);
    }

    // Concrete contracts should inherit from this contract and then should only
    // need to implement a `computeNpv`/`initialNpv` function. This allows for
    // generic choices of npv functions.
    function computeNpv() public view returns (int256 value);
    function initialNpv() public view returns (int256 value);

    function requiredAccountBalanceOnRemargin() public view returns (int256 balance) {
        return requiredAccountBalanceOnRemargin(msg.sender);
    }

    function deposit() public payable returns (bool success) {
        require(msg.sender == ownerAddress || msg.sender == counterpartyAddress);

        balances[msg.sender] += int256(msg.value);

        if (state == State.Prefunded) {
            if (balances[ownerAddress] > requiredAccountBalanceOnRemargin(ownerAddress) &&
                balances[counterpartyAddress] > requiredAccountBalanceOnRemargin(counterpartyAddress)) {
                state = State.Live;
            }
        }
        return true;
    }

    function withdraw(uint256 amount) public payable returns (bool success) {
        // Remargin before allowing a withdrawal.
        remargin();

        // If the contract has been defaulted on or terminated then can withdraw
        // up to full balance -- If not then they are required to leave at least
        // `required_margin` in the account. If the contract is in the prefunded
        // state, all parties are allowed to remove any balance they have in the
        // contract.
        int256 withdrawableAmount = (state >= State.Default || state == State.Prefunded) ?
            balances[msg.sender] :
            balances[msg.sender] - requiredMargin;

        // Can only withdraw the allowed amount
        require(
            (int256(withdrawableAmount) > int256(amount)),
            "Attempting to withdraw more than allowed"
        );

        // Transfer amount - Note: important to `-=` before the send so that the
        // function can not be called multiple times while waiting for transfer
        // to return
        balances[msg.sender] -= int256(amount);
        msg.sender.transfer(amount);

        return true;
    }

    function isDefault(address party) public constant returns (bool) {
        return balances[party] < requiredMargin;
    }

    function whoDefaults()
        public
        constant
        returns (bool inDefault, address defaulter, address notDefaulter)
    {
        inDefault = false;

        if (isDefault(ownerAddress)) {
            defaulter = ownerAddress;
            notDefaulter = counterpartyAddress;
            inDefault = true;
        } else if (isDefault(counterpartyAddress)) {
            defaulter = counterpartyAddress;
            notDefaulter = ownerAddress;
            inDefault = true;
        }

        return (inDefault, defaulter, notDefaulter);
    }

    function isTerminated(uint time) public constant returns (bool ttt) {
        ttt = state >= State.Expired || time > endTime;
    }

    // Remargins the account based on a provided NPV value.
    // The internal remargin method allows certain calls into the contract to automatically remargin to non-current NPV
    // values (time of expiry, last agreed upon price, etc).
    function remargin(int256 npvNew) internal {
        updateBalances(npvNew);

        // Check for default
        bool inDefault;
        address defaulter;
        address notDefaulter;
        (inDefault, defaulter, notDefaulter) = whoDefaults();

        // Check whether goes into default
        if (inDefault) {
            int256 penalty;
            penalty = (balances[defaulter] < defaultPenalty) ?
                balances[defaulter] :
                defaultPenalty;

            balances[defaulter] -= penalty;
            balances[notDefaulter] += penalty;
            state = State.Default;
        }
    }

    // Gets the change change in balance for the owners account when the most recent NPV is applied.
    // Note: there's a function for this because signage is tricky here, and it must be done the same everywhere.
    function getOwnerNpvDiff(int256 npvNew) internal view returns (int256 ownerNpvDiff) {
        return npv - npvNew;
    }

    function updateBalances(int256 npvNew) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update npv state variable.
        int256 ownerDiff = getOwnerNpvDiff(npvNew);
        npv = npvNew;

        balances[ownerAddress] += ownerDiff;
        balances[counterpartyAddress] -= ownerDiff;
    }

    function requiredAccountBalanceOnRemargin(address party) internal view returns (int256 balance) {
        int256 ownerDiff = getOwnerNpvDiff(computeNpv());

        if (party == ownerAddress) {
            return requiredMargin + ownerDiff;
        }

        if (party == counterpartyAddress) {
            return requiredMargin - ownerDiff;
        }

        return 0;
    }
}


contract DerivativeZeroNPV is Derivative, usingOraclize {

    function computeNpv() public view returns (int256 value) {
        string memory p = oracle.ethUsd();
        int256 price = int256(parseInt(p, 2));

        return price;
    }

    function initialNpv() public view returns (int256 value) {
        return 0;
    }
}
