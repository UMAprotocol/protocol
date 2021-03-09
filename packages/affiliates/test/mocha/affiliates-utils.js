const { assert } = require("chai");
const utils = require("../../libs/affiliates/utils");
const moment = require("moment");

describe("affiliates/utils", function() {
  it("getWeekByDate", function() {
    const start = moment("2021", "YYYY")
      .startOf("year")
      .valueOf();
    let now = moment("2021", "YYYY")
      .startOf("year")
      .add(0, "weeks")
      .valueOf();
    let result = utils.getWeekByDate(now, start);
    assert.equal(result, 0);

    now = moment("2021", "YYYY")
      .startOf("year")
      .add(0.5, "weeks")
      .valueOf();
    result = utils.getWeekByDate(now, start);
    assert.equal(result, 0);

    now = moment("2021", "YYYY")
      .startOf("year")
      .add(1, "weeks")
      .valueOf();
    result = utils.getWeekByDate(now, start);
    assert.equal(result, 1);
  });
  it("miningPeriodByWeek", function() {
    let start = moment("2021", "YYYY")
      .startOf("year")
      .valueOf();
    let week = 0;
    let result = utils.miningPeriodByWeek(week, start);
    assert.equal(result.startTime, start);
    assert.equal(
      result.endTime,
      moment(start)
        .add(1, "week")
        .valueOf()
    );
    assert.equal(result.weekNumber, week);

    week = 1;
    result = utils.miningPeriodByWeek(week, start);
    assert.equal(
      result.startTime,
      moment(start)
        .add(1, "week")
        .valueOf()
    );
    assert.equal(
      result.endTime,
      moment(start)
        .add(2, "week")
        .valueOf()
    );
    assert.equal(result.weekNumber, week);
  });

  it("getDevMiningWeek", function() {
    let result = utils.getLastDevMiningWeek();
    assert.ok(result > 0);
    result = utils.getCurrentDevMiningWeek();
    assert.ok(result > 0);
  });
  it("getDappMiningWeek", function() {
    let result = utils.getLastDappMiningWeek();
    assert.ok(result > 0);
    result = utils.getCurrentDappMiningWeek();
    assert.ok(result > 0);
  });
  it("compare dev mining week vs dapp mining week", function() {
    assert.ok(utils.getCurrentDevMiningWeek() > utils.getCurrentDappMiningWeek());
    assert.ok(utils.getLastDevMiningWeek() > utils.getLastDappMiningWeek());
  });
  it("makeDevMiningFilename", function() {
    const startTime = moment("2021", "YYYY")
      .startOf("year")
      .valueOf();
    const endTime = moment("2021", "YYYY")
      .startOf("year")
      .add(1, "week")
      .valueOf();
    const result = utils.makeDevMiningFilename({
      startTime,
      endTime,
      weekNumber: 10
    });
    assert.ok(result);
  });
  it("makeDappMiningFilename", function() {
    const startTime = moment("2021", "YYYY")
      .startOf("year")
      .valueOf();
    const endTime = moment("2021", "YYYY")
      .startOf("year")
      .add(1, "week")
      .valueOf();
    const result = utils.makeDappMiningFilename({
      startTime,
      endTime,
      weekNumber: 10
    });
    assert.ok(result);
  });
  it("generateDappMiningConfig", function() {
    const result = utils.generateDappMiningConfig({ empRewards: 1000, whitelistTable: [] });
    assert.ok(result);
    assert(result.endTime < Date.now());
    assert(result.startTime < result.endTime);
  });
});
