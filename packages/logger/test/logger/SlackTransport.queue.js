const { assert } = require("chai");
const sinon = require("sinon");
const axios = require("axios");
const winston = require("winston");

const webhook = "https://slack.test/secret-webhook";
const info = (message) => ({ level: "info", at: "Test", message });

describe("SlackTransport: shared delivery queue", function () {
  let clock;
  let post;
  let create;
  let SlackTransport;

  beforeEach(function () {
    clock = sinon.useFakeTimers();
    post = sinon.stub().resolves({ status: 200 });
    create = sinon.stub(axios, "create").returns({ post });
    sinon.stub(Math, "random").returns(0);
    delete require.cache[require.resolve("../../dist/logger/SlackTransport.js")];
    SlackTransport = require("../../dist/logger/SlackTransport.js");
  });

  afterEach(function () {
    sinon.restore();
    clock.restore();
    delete require.cache[require.resolve("../../dist/logger/SlackTransport.js")];
  });

  function transport(url = webhook) {
    const slack = SlackTransport.createSlackTransport({ defaultWebHookUrl: url });
    slack.errors = [];
    slack.on("error", (error) => slack.errors.push(error));
    return slack;
  }

  it("paces FIFO requests across transports sharing a webhook", async function () {
    const first = transport();
    const second = transport();
    const callbacks = [sinon.spy(), sinon.spy(), sinon.spy()];
    first.log(info("first"), callbacks[0]);
    second.log(info("second"), callbacks[1]);
    first.log(info("third"), callbacks[2]);
    assert.isFalse(first.isFlushed);
    assert.isFalse(second.isFlushed);
    await clock.tickAsync(0);
    assert.equal(post.callCount, 1);
    await clock.tickAsync(999);
    assert.equal(post.callCount, 1);
    await clock.tickAsync(1);
    assert.equal(post.callCount, 2);
    await clock.tickAsync(1000);
    assert.equal(post.callCount, 3);
    assert.deepEqual(
      post.getCalls().map((call) => call.args[1].blocks[0].text.text.match(/⭢(.*)\n/)[1]),
      ["first", "second", "third"]
    );
    callbacks.forEach((callback) => sinon.assert.calledOnce(callback));
    assert.isTrue(first.isFlushed);
    assert.isTrue(second.isFlushed);
  });

  it("paces all chunks of a split message before sending the next message", async function () {
    const first = transport();
    const second = transport();
    first.log({ ...info("split"), mrkdwn: `${"a".repeat(2000)}\n${"b".repeat(2000)}` }, sinon.spy());
    second.log(info("next"), sinon.spy());
    await clock.tickAsync(0);
    assert.equal(post.callCount, 1);
    await clock.tickAsync(1000);
    assert.equal(post.callCount, 2);
    assert.notInclude(JSON.stringify(post.secondCall.args[1]), "next");
    await clock.tickAsync(1000);
    assert.equal(post.callCount, 3);
    assert.include(JSON.stringify(post.thirdCall.args[1]), "next");
  });

  it("does not block an unrelated webhook", async function () {
    const first = transport();
    const other = transport("https://slack.test/other-webhook");
    first.log(info("first"), sinon.spy());
    first.log(info("waiting"), sinon.spy());
    other.log(info("other"), sinon.spy());
    await clock.tickAsync(0);
    assert.equal(post.callCount, 2);
    assert.equal(post.secondCall.args[0], "https://slack.test/other-webhook");
    await clock.tickAsync(1000);
    assert.equal(post.callCount, 3);
  });

  it("honors a shared cooldown even after the final 429 exhausts retries", async function () {
    const rateLimit = new Error("rate limited");
    rateLimit.response = { status: 429, headers: { "retry-after": "20" } };
    post.onCall(0).rejects(rateLimit);
    post.onCall(1).rejects(rateLimit);
    post.onCall(2).rejects(rateLimit);
    const first = transport();
    const second = transport();
    const failed = sinon.spy();
    first.log(info("limited"), failed);
    second.log(info("next"), sinon.spy());
    await clock.tickAsync(0);
    await clock.tickAsync(19999);
    assert.equal(post.callCount, 1);
    await clock.tickAsync(1);
    assert.equal(post.callCount, 2);
    await clock.tickAsync(20000);
    assert.equal(post.callCount, 3);
    sinon.assert.calledOnce(failed);
    assert.lengthOf(first.errors, 1);
    assert.isFalse(second.isFlushed);
    await clock.tickAsync(19999);
    assert.equal(post.callCount, 3);
    await clock.tickAsync(1);
    assert.equal(post.callCount, 4);
  });

  for (const retryAfter of ["3600", new Date(3600000).toUTCString()]) {
    it(`drops and reports long cooldown messages without posting early (${retryAfter})`, async function () {
      const rateLimit = new Error(`rate limited ${webhook}`);
      rateLimit.response = { status: 429, headers: { "retry-after": retryAfter } };
      post.onFirstCall().rejects(rateLimit);
      const first = transport();
      const second = transport();
      first.log(info("limited"), sinon.spy());
      second.log(info("queued"), sinon.spy());
      await clock.tickAsync(0);
      await first.flush();
      await second.flush();
      assert.equal(post.callCount, 1);
      for (const slack of [first, second]) {
        assert.lengthOf(slack.errors, 1);
        assert.include(slack.errors[0].originalError.message, "cooldown exceeds 60 seconds");
        assert.notInclude(JSON.stringify(slack.errors[0]), webhook);
        assert.isTrue(slack.isFlushed);
      }
      const later = transport();
      later.log(info("still limited"), sinon.spy());
      await clock.tickAsync(0);
      assert.lengthOf(later.errors, 1);
      assert.equal(post.callCount, 1);
      assert.equal(clock.countTimers(), 0);
      await clock.tickAsync(3600000);
      later.log(info("after cooldown"), sinon.spy());
      await clock.tickAsync(0);
      assert.equal(post.callCount, 2);
      assert.isTrue(later.isFlushed);
    });
  }

  it("allows a 60-second Retry-After plus bounded jitter", async function () {
    Math.random.returns(0.999);
    const rateLimit = new Error("rate limited");
    rateLimit.response = { status: 429, headers: { "retry-after": "60" } };
    post.onFirstCall().rejects(rateLimit);
    const slack = transport();
    slack.log(info("limited"), sinon.spy());
    await clock.tickAsync(60000);
    assert.equal(post.callCount, 1);
    await clock.tickAsync(250);
    assert.equal(post.callCount, 2);
    assert.lengthOf(slack.errors, 0);
  });

  it("drains pending HTTP work and Winston buffered writes", async function () {
    let finish;
    post.onFirstCall().returns(new Promise((resolve) => (finish = resolve)));
    const slack = transport();
    const logger = winston.createLogger({ transports: [slack] });
    slack.cork();
    logger.info(info("first"));
    logger.info(info("buffered"));
    let flushed = false;
    const draining = slack.flush().then(() => (flushed = true));
    await clock.tickAsync(0);
    assert.isFalse(slack.isFlushed);
    assert.isFalse(flushed);
    assert.equal(post.callCount, 0);
    slack.uncork();
    await clock.tickAsync(0);
    finish({ status: 200 });
    await clock.tickAsync(999);
    assert.equal(post.callCount, 1);
    assert.isFalse(flushed);
    await clock.tickAsync(101);
    await draining;
    assert.equal(post.callCount, 2);
    assert.isTrue(slack.isFlushed);
    logger.close();
  });

  it("never replays a delivered chunk when a later chunk fails", async function () {
    post.onCall(1).rejects(new Error("socket hang up"));
    const slack = transport();
    const failed = sinon.spy();
    slack.log({ ...info("split"), mrkdwn: `${"a".repeat(2000)}\n${"b".repeat(2000)}` }, failed);
    slack.log(info("next"), sinon.spy());
    await clock.tickAsync(2100);
    assert.equal(post.callCount, 3);
    sinon.assert.calledOnce(failed);
    assert.instanceOf(slack.errors[0], Error);
    assert.include(JSON.stringify(post.thirdCall.args[1]), "next");
    assert.isTrue(slack.isFlushed);
  });

  it("reports a terminal error and still drains subsequent Winston messages", async function () {
    post.onFirstCall().rejects(new Error("socket hang up"));
    const slack = transport();
    const logger = winston.createLogger({ transports: [slack] });
    const errors = [];
    logger.on("error", (error) => errors.push(error));
    logger.info(info("failed"));
    logger.info(info("next"));
    await clock.tickAsync(1100);
    await slack.flush();
    assert.lengthOf(errors, 1);
    assert.equal(post.callCount, 2);
    assert.include(JSON.stringify(post.secondCall.args[1]), "next");
    assert.isTrue(slack.isFlushed);
    logger.close();
  });

  it("adds bounded positive jitter without shortening Retry-After", async function () {
    Math.random.returns(0.999);
    const rateLimit = new Error("rate limited");
    rateLimit.response = { status: 429, headers: { "retry-after": "2" } };
    post.onFirstCall().rejects(rateLimit);
    const slack = transport();
    slack.log(info("limited"), sinon.spy());
    await clock.tickAsync(2000);
    assert.equal(post.callCount, 1);
    await clock.tickAsync(250);
    assert.equal(post.callCount, 2);
  });

  it("sets a finite HTTP timeout and excludes webhook secrets from errors", async function () {
    const error = new Error(`request failed for ${webhook}`);
    error.config = { url: webhook };
    post.rejects(error);
    const slack = transport();
    const failed = sinon.spy();
    slack.log(info("failed"), failed);
    await clock.tickAsync(0);
    assert.isAbove(create.firstCall.args[0].timeout, 0);
    assert.isBelow(create.firstCall.args[0].timeout, 60000);
    sinon.assert.calledOnce(failed);
    assert.lengthOf(slack.errors, 1);
    assert.notInclude(JSON.stringify(slack.errors[0]), webhook);
  });
});
