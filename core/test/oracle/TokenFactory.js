const { didContractThrow } = require("../../../common/SolidityTestUtils.js");

// Tested Contract
const TokenFactory = artifacts.require("TokenFactory");

// Helper contracts
const Token = artifacts.require("SyntheticToken");

const { toWei, toBN } = web3.utils;

contract("TokenFactory", function(accounts) {
  const contractDeployer = accounts[0];
  const tokenCreator = accounts[1];
  const rando = accounts[2];

  let tokenFactory;

  const tokenDetails = {
    name: "UMA Token",
    symbol: "UMA",
    decimals: "18"
  };

  before(async () => {
    tokenFactory = await TokenFactory.deployed();
  });
  it("Can create new tokens and transfers roles successfully", async () => {
    const tokenAddress = await tokenFactory.createToken.call(
      tokenDetails.name,
      tokenDetails.symbol,
      tokenDetails.decimals,
      {
        from: tokenCreator
      }
    );
    await tokenFactory.createToken(tokenDetails.name, tokenDetails.symbol, tokenDetails.decimals, {
      from: tokenCreator
    });
    const token = await Token.at(tokenAddress);

    // Creator should be only minter
    assert.isFalse(await token.isMinter(contractDeployer));
    assert.isTrue(await token.isMinter(tokenCreator));

    // Creator should be only burner
    assert.isFalse(await token.isBurner(contractDeployer));
    assert.isTrue(await token.isBurner(tokenCreator));

    // Contract deployer should no longer be capable of adding new roles
    assert(await didContractThrow(token.addMinter(rando, { from: contractDeployer })));
    assert(await didContractThrow(token.addBurner(rando, { from: contractDeployer })));

    // Creator should be able to add and remove a new minter
    await token.addMinter(rando, { from: tokenCreator });
    assert.isTrue(await token.isMinter(rando));
    await token.removeMinter(rando, { from: tokenCreator });
    assert.isFalse(await token.isMinter(rando));

    // Creator should be able to add a new burner
    await token.addBurner(rando, { from: tokenCreator });
    assert.isTrue(await token.isBurner(rando));
    await token.removeBurner(rando, { from: tokenCreator });
    assert.isFalse(await token.isBurner(rando));
  });
  it("Token can execute expected methods", async () => {
    const tokenAddress = await tokenFactory.createToken.call(
      tokenDetails.name,
      tokenDetails.symbol,
      tokenDetails.decimals,
      {
        from: tokenCreator
      }
    );
    await tokenFactory.createToken(tokenDetails.name, tokenDetails.symbol, tokenDetails.decimals, {
      from: tokenCreator
    });
    const token = await Token.at(tokenAddress);

    // Check ERC20Detailed methods
    assert.equal(await token.name(), tokenDetails.name);
    assert.equal(await token.symbol(), tokenDetails.symbol);
    assert.equal((await token.decimals()).toString(), tokenDetails.decimals);

    // Mint rando some tokens
    const amountToMint = toWei("10.5").toString();
    await token.mint(rando, amountToMint, { from: tokenCreator });
    assert.equal((await token.balanceOf(rando)).toString(), amountToMint);
    assert.equal((await token.totalSupply()).toString(), amountToMint);

    // Transfer some tokens to another account
    const amountToTransfer = toWei("1").toString();
    await token.transfer(contractDeployer, amountToTransfer, { from: rando });
    assert.equal(
      (await token.balanceOf(rando)).toString(),
      toBN(amountToMint)
        .sub(toBN(amountToTransfer))
        .toString()
    );
    assert.equal((await token.balanceOf(contractDeployer)).toString(), amountToTransfer);

    // Other account cannot burn any tokens because they are not a burner
    assert(await didContractThrow(token.burn(amountToTransfer, { from: contractDeployer })));

    // Token creator grants burning privileges to recipient of tokens
    await token.addBurner(contractDeployer, { from: tokenCreator });
    await token.burn(amountToTransfer, { from: contractDeployer });
    assert.equal((await token.balanceOf(contractDeployer)).toString(), "0");

    // Increase allowance for a spender, have spender transferFrom tokens away, and decrease allowance
    await token.increaseAllowance(tokenCreator, amountToTransfer, { from: rando });
    await token.increaseAllowance(tokenCreator, amountToTransfer, { from: rando });
    await token.transferFrom(rando, tokenCreator, amountToTransfer, { from: tokenCreator });
    await token.decreaseAllowance(tokenCreator, amountToTransfer, { from: rando });
    assert.equal((await token.allowance(rando, tokenCreator)).toString(), "0");

    // Burn remaining tokens
    await token.burn(amountToTransfer, { from: tokenCreator });
    await token.addBurner(rando, { from: tokenCreator });
    await token.burn(toWei("8.5".toString()), { from: rando });
    assert.equal((await token.balanceOf(rando)).toString(), "0");
    assert.equal((await token.totalSupply()).toString(), "0");
  });
});
