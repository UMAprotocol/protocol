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
    const expectedText = cloneLines(line, 1000);
    const block = createBlock(expectedText);
    const splitBlocks = splitByNewLine(block);

    // The message should be split into 4 separate blocks to remain under the limit.
    assert.equal(splitBlocks.length, 4);
    let actualText = "";
    for (const block of splitBlocks) {
      assert.isTrue(block.text.text.length < SLACK_MAX_CHAR_LIMIT);
      actualText += block.text.text;
    }
    assert.equal(actualText, expectedText);
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
