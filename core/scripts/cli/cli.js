const cli = async function(callback) {
  try {
    console.log("You have started the UMA CLI!");
  } catch (e) {
    console.log("ERROR: " + e);
  }

  callback();
};

module.exports = cli;
