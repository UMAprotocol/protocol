const argv = require("minimist")(process.argv.slice(), { string: ["to", "token", "amount"] });

const ERC20MintableData = require("openzeppelin-solidity/build/contracts/ERC20Mintable.json");
const truffleContract = require("truffle-contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

const mintNewTokens = async function(callback) {
  try {
    const deployer = (await web3.eth.getAccounts())[0];

    // Initialize the token contract from the address.
    const marginToken = await ERC20Mintable.at(argv.token);

    // Mint new tokens.
    await marginToken.mint(argv.to, web3.utils.toWei(argv.amount, "ether"), { from: deployer });

    console.log("Added " + argv.amount.toString() + " of token at " + marginToken.address + " to account " + argv.to);
  } catch (e) {
    console.log("ERROR: " + e);
  }

  callback();
};

module.exports = mintNewTokens;
