const { assert } = require("chai");
const sinon = require("sinon");
const axios = require("axios");
const { TransportError } = require("../../dist/logger/TransportError.js");

describe("SlackTransport: retry Slack posts", function () {
  let axiosCreateStub;
  let postStub;
  let SlackTransport;

  beforeEach(function () {
    postStub = sinon.stub();
    axiosCreateStub = sinon.stub(axios, "create").returns({ post: postStub });
    delete require.cache[require.resolve("../../dist/logger/SlackTransport.js")];
    SlackTransport = require("../../dist/logger/SlackTransport.js");
  });

  afterEach(function () {
    axiosCreateStub.restore();
    delete require.cache[require.resolve("../../dist/logger/SlackTransport.js")];
  });

  it("retries HTTP 429 and succeeds without returning a TransportError", async function () {
    postStub.onFirstCall().rejects(createAxiosResponseError(429, { "retry-after": "0" }));
    postStub.onSecondCall().resolves({ status: 200 });

    const transport = SlackTransport.createSlackTransport({ defaultWebHookUrl: "https://slack.test/webhook" });
    const callbackArg = await logWithCallback(transport);

    assert.isUndefined(callbackArg);
    assert.equal(postStub.callCount, 2);
  });

  it("returns TransportError after retryable Slack failures are exhausted", async function () {
    postStub.rejects(createAxiosResponseError(429, { "retry-after": "0" }));

    const transport = SlackTransport.createSlackTransport({ defaultWebHookUrl: "https://slack.test/webhook" });
    const callbackArg = await logWithCallback(transport);

    assert.instanceOf(callbackArg, TransportError);
    assert.equal(postStub.callCount, SlackTransport.SLACK_MAX_POST_RETRIES + 1);
  });

  it("does not retry Slack 5xx responses because delivery may have succeeded", async function () {
    postStub.rejects(createAxiosResponseError(503));

    const transport = SlackTransport.createSlackTransport({ defaultWebHookUrl: "https://slack.test/webhook" });
    const callbackArg = await logWithCallback(transport);

    assert.instanceOf(callbackArg, TransportError);
    assert.equal(postStub.callCount, 1);
  });

  it("does not retry connection-level failures because delivery is ambiguous", async function () {
    postStub.rejects(new Error("socket hang up"));

    const transport = SlackTransport.createSlackTransport({ defaultWebHookUrl: "https://slack.test/webhook" });
    const callbackArg = await logWithCallback(transport);

    assert.instanceOf(callbackArg, TransportError);
    assert.equal(postStub.callCount, 1);
  });

  it("caps Retry-After delays", function () {
    const delaySeconds = SlackTransport.getSlackPostRetryDelaySeconds(
      createAxiosResponseError(429, { "retry-after": "90" }),
      0
    );

    assert.equal(delaySeconds, SlackTransport.SLACK_MAX_RETRY_DELAY_SECONDS);
  });
});

async function logWithCallback(transport) {
  return new Promise((resolve) => {
    transport.log({ level: "warn", at: "Test", message: "Test" }, resolve);
  });
}

function createAxiosResponseError(status, headers = {}) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, headers };
  return error;
}
