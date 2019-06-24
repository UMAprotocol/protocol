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

  if ('mnemonic' in config) {
    let envFile = await readFile("../.env", "utf8");

    if (envFile.length !== 0 && envFile[envFile.length - 1] != "\n") {
      envFile += "\n";
    }

    envFile += `MNEMONIC=${config.mnemonic}\n`;

    await writeFile("../.env", envFile);
  }
};

processConfig().catch(console.error);
