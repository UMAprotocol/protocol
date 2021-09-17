const run = async (callback) => {
  console.log("RUNNING");
  callback();
};

function nodeCallback(err) {
  if (err) {
    console.error(err);
    process.exit(1);
  } else process.exit(0);
}

// If called directly by node, execute the Poll Function. This lets the script be run as a node process.
if (require.main === module) {
  run(nodeCallback)
    .then(() => {})
    .catch(nodeCallback);
}

module.exports = run;
