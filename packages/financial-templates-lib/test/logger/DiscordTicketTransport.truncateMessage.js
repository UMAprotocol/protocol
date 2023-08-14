const { assert } = require("chai");
const { DiscordTicketTransport } = require("../../dist/logger/DiscordTicketTransport");

describe("DiscordTicketTransport: preserve url in truncated discord ticket", function () {
  const TRUNCATED = " [TRUNCATED] ";

  let discordTicketTransport;
  before(function () {
    discordTicketTransport = new DiscordTicketTransport(undefined, { botToken: "testToken" });
  });
  it("Retain message in sufficient limit", function () {
    const message = "Test message";
    const limit = Math.max(message.length, TRUNCATED.length);
    const truncatedMessage = discordTicketTransport.truncateMessage(message, limit);
    assert.equal(truncatedMessage, message);
    assert.isAtMost(truncatedMessage.length, message.length);
  });
  it("Truncate message in insufficient limit", function () {
    const message = "Plain long test message";
    const limit = message.length - 1;
    const truncatedMessage = discordTicketTransport.truncateMessage(message, limit);
    assert.equal(truncatedMessage, "Plain lon" + TRUNCATED);
    assert.equal(truncatedMessage.length, limit);
  });
  it("Truncate longer text after url", function () {
    const message = "https://example.com followed by some longer text";
    const limit = message.length - 1;
    const truncatedMessage = discordTicketTransport.truncateMessage(message, limit);
    assert.equal(truncatedMessage, "https://example.com followed by so" + TRUNCATED);
    assert.equal(truncatedMessage.length, limit);
  });
  it("Truncate entire url in insufficient limit", function () {
    const message = "https://example.com short text";
    const limit = message.length - 1;
    const truncatedMessage = discordTicketTransport.truncateMessage(message, limit);
    assert.equal(truncatedMessage, TRUNCATED + " short text");
    assert.isAtMost(truncatedMessage.length, message.length);
  });
  it("Truncate longer text before url", function () {
    const message = "Some long test text before https://example.com";
    const limit = message.length - 1;
    const truncatedMessage = discordTicketTransport.truncateMessage(message, limit);
    assert.equal(truncatedMessage, "Some long tes" + TRUNCATED + "https://example.com");
    assert.equal(truncatedMessage.length, limit);
  });
});
