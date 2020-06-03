const fs = require("fs");

/**
 * @notice Redirects the process.stdout stream to a file.
 * @param {String} logFilePath Relative path to file to redirect output to.
 * @return Stream object (https://nodejs.org/api/stream.html#stream_stream)
 */
const redirectStdOutToFile = logFilePath => {
  try {
    const stream = fs.createWriteStream(logFilePath);
    process.stdout.write = stream.write.bind(stream);
    return stream;
  } catch (err) {
    console.error("Something failed when redirecting process.stdout to file", err);
  }
};

module.exports = {
  redirectStdOutToFile
};
