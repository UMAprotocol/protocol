// start apps in the app folder: npx ts-node src/start ${appname}
// to see a list of apps, look in src/apps, the folders match the app name
require("dotenv").config();
import minimist from "minimist";
import assert from "assert";
import * as Apps from "./apps";
const args: string[] = minimist(process.argv.slice(2))._;
const [appType] = args;
assert(appType, `requires app name, for example: ts-node src/start api`);

type AppType = keyof typeof Apps;

const app = Apps[appType.toLowerCase() as AppType];

assert(app, `No such app: ${appType}`);

app(process.env)
  .then(() => console.log(`${appType} started`))
  .catch(console.error);
