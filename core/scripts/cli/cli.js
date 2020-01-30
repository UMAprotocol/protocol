const inquirer = require("inquirer");
const vote = require("./vote");

const collectInputs = async (inputs = []) => {
  const prompts = [
    {
      type: "list",
      name: "topMenu",
      message: "What do you want to do?",
      choices: ["DVM system status", "wallet", "vote", "claim rewards", "help", "exit"]
    }
  ];

  const { again, ...answers } = await inquirer.prompt(prompts);
  const newInputs = [...inputs, answers];
  return again ? collectInputs(newInputs) : newInputs;
};

async function run() {
  let run = true;
  while (run) {
    const inputs = await collectInputs();
    // console.log(inputs);
    await vote();
  }
}

module.exports = async function(cb) {
  try {
    await run();
  } catch (err) {
    console.log(err);
  }
  cb();
};

run().then(function() {
  console.log("run");
});
