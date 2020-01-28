const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const Position = artifacts.require("Position");
const Token = artifacts.require("Token");
// Helper Contracts
const ERC20MintableData = require("@openzeppelin/contracts/build/contracts/ERC20Mintable.json");
const truffleContract = require("@truffle/contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

contract("Position", function(accounts) {
  const { toWei } = web3.utils;
  const sponsor = accounts[0];
  const other = accounts[1];
  const collateralOwner = accounts[2];
  let collateral;

  before(async function() {
    collateral = await ERC20Mintable.new({ from: collateralOwner });
    await collateral.mint(sponsor, toWei("1000000"), { from: collateralOwner });
    await collateral.mint(other, toWei("1000000"), { from: collateralOwner });
  });

  it("Lifecycle", async function() {
    const expirationTimestamp = "15798990420";
    const position = await Position.new(expirationTimestamp, collateral.address, true);
    const token = await Token.at(await position.token());

    // Create a second, very big and lowly collateralization position.
    await collateral.approve(position.address, toWei("1000"), { from: other });
    await position.create({ rawValue: toWei("1") }, { rawValue: toWei("1000") }, { from: other });

    // Create the initial position.
    // Fails without approving collateral.
    assert(
      await didContractThrow(position.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor }))
    );
    await collateral.approve(position.address, toWei("150"), { from: sponsor });
    await position.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor });
    let positionData = await position.positions(sponsor);
    assert.equal(positionData.sponsor, sponsor);
    assert.equal(positionData.collateral.toString(), toWei("150"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("100"));
    assert.equal((await token.balanceOf(sponsor)).toString(), toWei("100"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("151"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("1100"));
    assert.equal((await collateral.balanceOf(position.address)).toString(), toWei("151"));

    // Deposit.
    // Fails without approving collateral.
    assert(await didContractThrow(position.deposit({ rawValue: toWei("50") }, { from: sponsor })));
    await collateral.approve(position.address, toWei("50"), { from: sponsor });
    await position.deposit({ rawValue: toWei("50") }, { from: sponsor });
    positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("200"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("100"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("201"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("1100"));
    assert.equal((await collateral.balanceOf(position.address)).toString(), toWei("201"));

    // Withdraw.
    let sponsorInitialBalance = await collateral.balanceOf(sponsor);
    await position.withdraw({ rawValue: toWei("20") }, { from: sponsor });
    let sponsorFinalBalance = await collateral.balanceOf(sponsor);
    positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("180"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("100"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("181"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("1100"));
    assert.equal((await collateral.balanceOf(position.address)).toString(), toWei("181"));
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), toWei("20"));

    // Redeem partial.
    // Fails without approving collateral.
    assert(await didContractThrow(position.redeem({ rawValue: toWei("50") }, { from: sponsor })));
    await token.approve(position.address, toWei("50"), { from: sponsor });
    sponsorInitialBalance = await collateral.balanceOf(sponsor);
    await position.redeem({ rawValue: toWei("50") }, { from: sponsor });
    sponsorFinalBalance = await collateral.balanceOf(sponsor);
    positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("90"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("50"));
    assert.equal((await token.balanceOf(sponsor)).toString(), toWei("50"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("91"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("1050"));
    assert.equal((await collateral.balanceOf(position.address)).toString(), toWei("91"));
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), toWei("90"));

    // Create additional.
    await collateral.approve(position.address, toWei("110"), { from: sponsor });
    await position.create({ rawValue: toWei("110") }, { rawValue: toWei("10") }, { from: sponsor });
    positionData = await position.positions(sponsor);
    assert.equal(positionData.sponsor, sponsor);
    assert.equal(positionData.collateral.toString(), toWei("200"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("60"));
    assert.equal((await token.balanceOf(sponsor)).toString(), toWei("60"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("201"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("1060"));
    assert.equal((await collateral.balanceOf(position.address)).toString(), toWei("201"));

    // Redeem full.
    await token.approve(position.address, toWei("60"), { from: sponsor });
    sponsorInitialBalance = await collateral.balanceOf(sponsor);
    await position.redeem({ rawValue: toWei("60") }, { from: sponsor });
    sponsorFinalBalance = await collateral.balanceOf(sponsor);
    positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("0"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("0"));
    assert.equal((await token.balanceOf(sponsor)).toString(), toWei("0"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("1"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("1000"));
    assert.equal((await collateral.balanceOf(position.address)).toString(), toWei("1"));
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), toWei("200"));
  });

  it("Withdrawal request", async function() {
    const { toWei } = web3.utils;
    const expirationTimestamp = "15798990420";
    const position = await Position.new(expirationTimestamp, collateral.address, true);
    const token = await Token.at(await position.token());

    const startTime = await position.getCurrentTime();
    await collateral.approve(position.address, toWei("100000"), { from: sponsor });
    await collateral.approve(position.address, toWei("100000"), { from: other });
    await token.approve(position.address, toWei("100000"), { from: sponsor });

    // Create a second, very big and lowly collateralization position.
    await position.create({ rawValue: toWei("1") }, { rawValue: toWei("1000") }, { from: other });

    // Create the initial position.
    await position.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor });

    // Request withdrawal.
    await position.requestWithdrawal({ rawValue: toWei("25") }, { from: sponsor });

    // All other actions are locked.
    assert(await didContractThrow(position.deposit({ rawValue: toWei("1") }, { from: sponsor })));
    assert(await didContractThrow(position.withdraw({ rawValue: toWei("1") }, { from: sponsor })));
    assert(
      await didContractThrow(position.create({ rawValue: toWei("1") }, { rawValue: toWei("1") }, { from: sponsor }))
    );
    assert(await didContractThrow(position.redeem({ rawValue: toWei("1") }, { from: sponsor })));
    assert(await didContractThrow(position.requestWithdrawal({ rawValue: toWei("1") }, { from: sponsor })));

    // Can't withdraw before time is up.
    await position.setCurrentTime(startTime.toNumber() + 500);
    assert(await didContractThrow(position.withdrawPassedRequest({ from: sponsor })));

    // Can withdraw after time is up.
    await position.setCurrentTime(startTime.toNumber() + 1001);
    let sponsorInitialBalance = await collateral.balanceOf(sponsor);
    await position.withdrawPassedRequest({ from: sponsor });
    let sponsorFinalBalance = await collateral.balanceOf(sponsor);

    // Verify state of Position post-withdrawal.
    let positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("125"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("100"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("126"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("1100"));
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), toWei("25"));

    // Methods are now unlocked again.
    await position.deposit({ rawValue: toWei("1") }, { from: sponsor });
    await position.withdraw({ rawValue: toWei("1") }, { from: sponsor });
    await position.create({ rawValue: toWei("25") }, { rawValue: toWei("25") }, { from: sponsor });
    await position.redeem({ rawValue: toWei("25") }, { from: sponsor });
    positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("120"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("100"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("121"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("1100"));
  });

  it("Global collateralization ratio checks", async function() {
    const { toWei } = web3.utils;
    const expirationTimestamp = "15798990420";
    const position = await Position.new(expirationTimestamp, collateral.address, true);
    await collateral.approve(position.address, toWei("100000"), { from: sponsor });
    await collateral.approve(position.address, toWei("100000"), { from: other });

    // Create the initial position, with any collateralization ratio.
    await position.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor });

    // Any withdrawal requests should fail, because withdrawals would reduce the global collateralization ratio.
    assert(await didContractThrow(position.withdraw({ rawValue: toWei("1") }, { from: sponsor })));

    // A new position can't be created below the global ratio.
    assert(
      await didContractThrow(position.create({ rawValue: toWei("150") }, { rawValue: toWei("101") }, { from: sponsor }))
    );
    assert(
      await didContractThrow(position.create({ rawValue: toWei("150") }, { rawValue: toWei("101") }, { from: other }))
    );

    // A new position CAN be expanded or created above the global ratio.
    await position.create({ rawValue: toWei("15") }, { rawValue: toWei("10") }, { from: sponsor });
    await position.create({ rawValue: toWei("25") }, { rawValue: toWei("10") }, { from: other });

    // Can't withdraw below global ratio.
    assert(await didContractThrow(position.withdraw({ rawValue: toWei("1") }, { from: sponsor })));

    // For the "other" position:
    // global = (150 + 15 + 25) / (100 + 10 + 10) = 1.58333
    // To maintain 10 tokens, need at least 15.833 collateral => can withdraw from 25 down to 16 but not to 15.
    assert(await didContractThrow(position.withdraw({ rawValue: toWei("10") }, { from: other })));
    await position.withdraw({ rawValue: toWei("9") }, { from: other });
  });
});
