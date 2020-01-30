const inquirer = require("inquirer");

const vote = async () => {
  const prompts = [
    {
      type: "list",
      name: "topMenu",
      message: "What do you want to do?",
      choices: ["List all price requests", "commit specific vote", "reveal votes"]
    }
  ];

  answers = await inquirer.prompt(prompts);
};

module.exports = async function(cb) {
  try {
    await vote();
  } catch (err) {
    console.log(err);
  }
  return;
};
