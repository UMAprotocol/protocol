const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const Token = artifacts.require("ExpandedERC20");

const createMarginToken = async function(callback) {
  try {
    const deployer = (await web3.eth.getAccounts())[0];

    // Deploy the token.
    const marginToken = await Token.new({ from: deployer });

    // Mint deployer 1 million tokens.
    await marginToken.addMember(1, deployer, { from: deployer });
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
