pragma solidity ^0.4.22;

contract Derivative {
    // Financial information
    mapping(address => int256) public balances; // Stored in Wei
    address[] addressLUT;  // Array that stores relevant addresses
    int256 required_margin;  //

    // Contract states
    address owner_address;
    address counterparty_address;
    bool defaulted = false;
    bool terminated = false;
    uint start_time;
    uint end_time;

    uint256 npv;  // Net present value is measured in Wei

    function Constructor(
      address counterparty_address,
      uint start_time,
      uint end_time,
      int256 required_margin
      ) public {

        // Contract states
        start_time = start_time;
        end_time = end_time;
        required_margin = required_margin;
        uint256 npv = 0;

        // Address information
        address owner_address = msg.sender;
        address counterparty_address = counterparty_address;
        address[] addressLUT = [owner_address, counterparty_address];
        balances[owner_address] = 0;
        balances[counterparty_address] = 0;
    }

    function update_balances(int npv, int npv_new) {
        // Compute difference -- Add the difference to owner and subtract
        // from
        int npv_diff = npv - npv_new;

        balances[owner_address] += npv_diff
        balances[counterparty_address] -= npv_diff
    }

    function who_defaults() public returns (bool is_default, address defaulter) {
      // For loop over addressLUT and check each account for default
      return false, owner_address
    }

    function is_terminated(uint time) public returns (bool ttt){
      ttt = terminated || time > end_time;
    }

    // Concrete contracts should inherit from this contract and then should only
    // need to implement a `compute_npv` function. This allows for generic
    // choices of npv functions
    function compute_npv(uint256 price, uint256 wei_cent_conversion) public returns (uint256 value);

    function remargin(uint256 price, uint256 wei_exchangerate) {
        // Check if time is over

        // Update npv of contract
        uint npv_new = compute_npv(price, wei_exchangerate);
        update_balances(npv, npv_new);

        // Check for default
        defaulted, defaulter = who_defaults()
        if defaulted {
          balances[defaulter] -= min(balances[defaulter], default_penalty)
          terminated = true
        }
    }

    function deposit() payable public returns (bool success) {
      balances[msg.sender] += msg.value;
      return true;
    }

    function withdraw(uint256 amount) payable public returns (bool success) {
      // If the contract has been defaulted on or terminated then can withdraw
      // up to full balance -- If not, then they are required to leave at least
      // `required_margin` in the account
      if (defaulted || terminated) {
        if (balances[msg.sender] < amount) {
          throw;
        } else {
          msg.sender.transfer(amount)
        }
      } else {
        if (balances[msg.sender] - required_margin < amount) {
          throw;
        } else {
          msg.sender.transfer(amount)
        }
      }

      return true
    }

}
