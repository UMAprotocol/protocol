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

    // Contract states
    address public ownerAddress;          // should this be public?
    address public counterpartyAddress;   //

    State public state = State.Prefunded;
    uint public startTime;
    uint public endTime;

    VoteCoinInterface public oracle;
    address public oracleAddress;
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
        npv = setNpv();

        // Address information
        ownerAddress = msg.sender;
        oracleAddress = _oracleAddress;
        counterpartyAddress = _counterpartyAddress;
        balances[ownerAddress] = 0;
        balances[counterpartyAddress] = 0;
    }

    function remargin() external {
        // Check if time is over...
        // TODO: Ensure that the contract is remargined at the time that the
        // contract ends
        uint currentTime = now; // solhint-disable-line not-rely-on-time
        if (currentTime > endTime) {
            state = State.Expired;
        }

        // Update npv of contract
        int256 npvNew = computeNpv();
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

    // Concrete contracts should inherit from this contract and then should only
    // need to implement a `computeNpv`/`setNpv` function. This allows for
    //generic choices of npv functions
    function computeNpv() public returns (int256 value);
    function setNpv() public returns (int256 value);

    function deposit() public payable returns (bool success) {
        require(msg.sender == ownerAddress || msg.sender == counterpartyAddress);

        balances[msg.sender] += int256(msg.value);

        if (state = State.Prefunded) {
            if (balances[ownerAddress] > requiredMargin && balances[counterpartyAddress] > requiredMargin) {
                state = State.Live;
            }
        }
        return true;
    }

    function withdraw(uint256 amount) public payable returns (bool success) {
        // If the contract has been defaulted on or terminated then can withdraw
        // up to full balance -- If not then they are required to leave at least
        // `required_margin` in the account
        int256 withdrawableAmount = (state >= State.Default) ?
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

    function updateBalances(int256 npvNew) internal {
        // Compute difference -- Add the difference to owner and subtract
        // from counterparty. Then update npv state variable
        int256 npvDiff = npv - npvNew;
        npv = npvNew;

        balances[ownerAddress] += npvDiff;
        balances[counterpartyAddress] -= npvDiff;
    }

}


contract DerivativeZeroNPV is Derivative, usingOraclize {

    function computeNpv() public returns (int256 value) {
        oracle = VoteCoinInterface(oracleAddress);
        string memory p = oracle.ethUsd();
        int256 price = int256(parseInt(p, 2));

        return price;
    }

    function setNpv() public returns (int256 value) {
        value = 0;
    }
}
