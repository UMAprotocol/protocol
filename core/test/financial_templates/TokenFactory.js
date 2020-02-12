// Tested Contract
const TokenFactory = artifacts.require("TokenFactory");

// Helper Contracts
const Token = artifacts.require("Token");
const TokenInterface = artifacts.require("TokenInterface");

contract("TokenFactory", function(accounts) {
  const contractDeployer = accounts[0];
  const tokenCreator = accounts[1];

  let tokenFactory;

  const tokenDetails = {
    name: "UMA Token",
    symbol: "UMA",
    decimals: "18"
  };

  before(async () => {
    tokenFactory = await TokenFactory.deployed();
  });
  it("Can create new tokens and transfers minter role successfully", async () => {
    const token = await tokenFactory.createToken(tokenDetails.name, tokenDetails.symbol, tokenDetails.decimals, {
      from: tokenCreator
    });
    console.log(token);
  });
  it("Token can execute expected methods", async () => {});
});
