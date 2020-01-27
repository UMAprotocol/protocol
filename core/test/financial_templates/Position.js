const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const Position = artifacts.require("Position");

contract("Position", function(accounts) {
  const sponsor = accounts[0];

  it("Lifecycle", async function() {
    const { toWei } = web3.utils;
    const expirationTimestamp = "15798990420";
    const position = await Position.new(expirationTimestamp, true);

    // Create the initial position.
    await position.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor });
    let positionData = await position.positions(sponsor);
    assert.equal(positionData.sponsor, sponsor);
    assert.equal(positionData.collateral.toString(), toWei("150"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("100"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("150"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("100"));

    // Deposit.
    await position.deposit({ rawValue: toWei("50") }, { from: sponsor });
    positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("200"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("100"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("200"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("100"));

    // Withdraw.
    await position.withdraw({ rawValue: toWei("20") }, { from: sponsor });
    positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("180"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("100"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("180"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("100"));

    // Redeem partial.
    await position.redeem({ rawValue: toWei("50") }, { from: sponsor });
    positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("90"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("50"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("90"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("50"));

    // Create additional.
    await position.create({ rawValue: toWei("110") }, { rawValue: toWei("10") }, { from: sponsor });
    positionData = await position.positions(sponsor);
    assert.equal(positionData.sponsor, sponsor);
    assert.equal(positionData.collateral.toString(), toWei("200"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("60"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("200"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("60"));

    // Redeem full.
    await position.redeem({ rawValue: toWei("60") }, { from: sponsor });
    positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("0"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("0"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("0"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("0"));
  });

  it("Withdrawal request", async function() {
    const { toWei } = web3.utils;
    const expirationTimestamp = "15798990420";
    const position = await Position.new(expirationTimestamp, true);

    const startTime = await position.getCurrentTime();

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
    await position.withdrawPassedRequest({ from: sponsor });

    // Verify state of Position post-withdrawal.
    let positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("125"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("100"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("125"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("100"));

    // Methods are now unlocked again.
    await position.deposit({ rawValue: toWei("1") }, { from: sponsor });
    await position.withdraw({ rawValue: toWei("1") }, { from: sponsor });
    await position.create({ rawValue: toWei("25") }, { rawValue: toWei("25") }, { from: sponsor });
    await position.redeem({ rawValue: toWei("25") }, { from: sponsor });
    positionData = await position.positions(sponsor);
    assert.equal(positionData.collateral.toString(), toWei("120"));
    assert.equal(positionData.tokensOutstanding.toString(), toWei("100"));
    assert.equal((await position.totalPositionCollateral()).toString(), toWei("120"));
    assert.equal((await position.totalTokensOutstanding()).toString(), toWei("100"));
  });
});
