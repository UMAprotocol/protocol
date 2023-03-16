const hre = require("hardhat");
const { runDefaultFixture } = require("@uma/common");
const { getContract } = hre;
const { didContractThrow } = require("@uma/common");
const { assert } = require("chai");

// Tested Contract
const TokenFactory = getContract("TokenFactory");

// Helper contracts
const Token = getContract("SyntheticToken");

const { toWei, toBN } = web3.utils;

describe("TokenFactory", function () {
  let accounts;
  let contractDeployer;
  let tokenCreator;
  let rando;

  let tokenFactory;

  const tokenDetails = { name: "UMA Token", symbol: "UMA", decimals: "18" };

  before(async () => {
    accounts = await web3.eth.getAccounts();
    [contractDeployer, tokenCreator, rando] = accounts;
    await runDefaultFixture(hre);
    tokenFactory = await TokenFactory.deployed();
  });
  it("Can create new tokens and transfers roles successfully", async () => {
    const tokenAddress = await tokenFactory.methods
      .createToken(tokenDetails.name, tokenDetails.symbol, tokenDetails.decimals)
      .call({ from: tokenCreator });
    await tokenFactory.methods
      .createToken(tokenDetails.name, tokenDetails.symbol, tokenDetails.decimals)
      .send({ from: tokenCreator });
    const token = await Token.at(tokenAddress);

    // Creator should be only owner and no one should hold the mint or burn roles.
    assert.isFalse(await token.methods.isMinter(contractDeployer).call());
    assert.isFalse(await token.methods.isMinter(tokenCreator).call());
    assert.isFalse(await token.methods.isBurner(contractDeployer).call());
    assert.isFalse(await token.methods.isBurner(tokenCreator).call());
    assert.equal(await token.methods.getMember(0).call(), tokenCreator); // roleId 0 = owner.

    // Contract deployer should no longer be capable of adding new roles
    assert(await didContractThrow(token.methods.addMinter(rando).send({ from: contractDeployer })));
    assert(await didContractThrow(token.methods.addBurner(rando).send({ from: contractDeployer })));

    // Creator should be able to add and remove a new minter
    await token.methods.addMinter(rando).send({ from: tokenCreator });
    assert.isTrue(await token.methods.isMinter(rando).call());
    await token.methods.removeMinter(rando).send({ from: tokenCreator });
    assert.isFalse(await token.methods.isMinter(rando).call());

    // Creator should be able to add a new burner
    await token.methods.addBurner(rando).send({ from: tokenCreator });
    assert.isTrue(await token.methods.isBurner(rando).call());
    await token.methods.removeBurner(rando).send({ from: tokenCreator });
    assert.isFalse(await token.methods.isBurner(rando).call());
  });
  it("Token can execute expected methods", async () => {
    const tokenAddress = await tokenFactory.methods
      .createToken(tokenDetails.name, tokenDetails.symbol, tokenDetails.decimals)
      .call({ from: tokenCreator });
    await tokenFactory.methods
      .createToken(tokenDetails.name, tokenDetails.symbol, tokenDetails.decimals)
      .send({ from: tokenCreator });
    const token = await Token.at(tokenAddress);

    // Add the required roles to mint and burn.
    await token.methods.addMinter(tokenCreator).send({ from: tokenCreator });
    await token.methods.addBurner(tokenCreator).send({ from: tokenCreator });

    // Check ERC20Detailed methods
    assert.equal(await token.methods.name().call(), tokenDetails.name);
    assert.equal(await token.methods.symbol().call(), tokenDetails.symbol);
    assert.equal((await token.methods.decimals().call()).toString(), tokenDetails.decimals);

    // Mint rando some tokens
    const amountToMint = toWei("10.5").toString();
    await token.methods.mint(rando, amountToMint).send({ from: tokenCreator });
    assert.equal((await token.methods.balanceOf(rando).call()).toString(), amountToMint);
    assert.equal((await token.methods.totalSupply().call()).toString(), amountToMint);

    // Transfer some tokens to another account
    const amountToTransfer = toWei("1").toString();
    await token.methods.transfer(contractDeployer, amountToTransfer).send({ from: rando });
    assert.equal(
      (await token.methods.balanceOf(rando).call()).toString(),
      toBN(amountToMint).sub(toBN(amountToTransfer)).toString()
    );
    assert.equal((await token.methods.balanceOf(contractDeployer).call()).toString(), amountToTransfer);

    // Other account cannot burn any tokens because they are not a burner
    assert(await didContractThrow(token.methods.burn(amountToTransfer).send({ from: contractDeployer })));

    // Token creator grants burning privileges to recipient of tokens
    await token.methods.addBurner(contractDeployer).send({ from: tokenCreator });
    await token.methods.burn(amountToTransfer).send({ from: contractDeployer });
    assert.equal((await token.methods.balanceOf(contractDeployer).call()).toString(), "0");

    // Increase allowance for a spender, have spender transferFrom tokens away, and decrease allowance
    await token.methods.increaseAllowance(tokenCreator, amountToTransfer).send({ from: rando });
    await token.methods.increaseAllowance(tokenCreator, amountToTransfer).send({ from: rando });
    await token.methods.transferFrom(rando, tokenCreator, amountToTransfer).send({ from: tokenCreator });
    await token.methods.decreaseAllowance(tokenCreator, amountToTransfer).send({ from: rando });
    assert.equal((await token.methods.allowance(rando, tokenCreator).call()).toString(), "0");

    // Burn remaining tokens
    await token.methods.burn(amountToTransfer).send({ from: tokenCreator });
    await token.methods.addBurner(rando).send({ from: tokenCreator });
    await token.methods.burn(toWei("8.5".toString())).send({ from: rando });
    assert.equal((await token.methods.balanceOf(rando).call()).toString(), "0");
    assert.equal((await token.methods.totalSupply().call()).toString(), "0");
  });
});
