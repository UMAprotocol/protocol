const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const ERC20MintableData = require("openzeppelin-solidity/build/contracts/ERC20Mintable.json");
const truffleContract = require("truffle-contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

const createMarginToken = async function(callback) {
  try {
    const deployer = (await web3.eth.getAccounts())[0];

    // Deploy the token.
    const marginToken = await ERC20Mintable.new({ from: deployer });

    // Mint deployer 1 million tokens.
    await marginToken.mint(deployer, web3.utils.toWei("1000000", "ether"), { from: deployer });

    // Whitelist token.
    const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();
    const marginCurrencyWhitelist = await AddressWhitelist.at(
      await tokenizedDerivativeCreator.marginCurrencyWhitelist()
    );
    await marginCurrencyWhitelist.addToWhitelist(marginToken.address);

    console.log("New Token Deployed at: " + marginToken.address);
    console.log("New Token Deployed by: " + deployer);
  } catch (e) {
    console.log("ERROR: " + e);
  }

  callback();
};

module.exports = createMarginToken;
