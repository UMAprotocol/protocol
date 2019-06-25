const fs = require("fs");
const util = require("util");

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

const readDockerConfig = async function() {
  const data = await readFile("./docker-config/config.json");

  return JSON.parse(data);
};

const processConfig = async function() {
  const config = await readDockerConfig();

  if ("mnemonic" in config) {
    let envFile = await readFile("./.env", "utf8");

    // Always append the new parameter to the end of the file.
    // This overrides an existing parameter, if it exists, without overwriting it.
    if (envFile.length !== 0 && envFile[envFile.length - 1] != "\n") {
      envFile += "\n";
    }

    envFile += `MNEMONIC=${config.mnemonic}\n`;

    await writeFile("../.env", envFile);
  }
};

processConfig().catch(console.error);
