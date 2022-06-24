const { assert } = require("chai");
const { SLACK_MAX_CHAR_LIMIT, splitByNewLine } = require("../../dist/logger/SlackTransport");

describe("SlackTransport: split message to fit character limit", async function () {
  it("Should not split if already under limit", async function () {
    const block = createBlock("Still under the limit");
    const splitBlocks = splitByNewLine(block);
    assert.deepEqual(splitBlocks, [block]);
  });

  it("Split by new lines", async function () {
    const line = "0123456789\n";
    const text = cloneLines(line, 1000);
    const block = createBlock(text);
    const splitBlocks = splitByNewLine(block);

    for (const block of splitBlocks) {
      assert.isTrue(block.text.text.length < SLACK_MAX_CHAR_LIMIT);
    }
  });
});

function cloneLines(line, numLines) {
  let text = "";
  for (let i = 0; i < numLines; i++) text += line;
  return text;
}

function createBlock(text) {
  return { type: "section", text: { type: "mrkdwn", text: text } };
}
