// this file is adapted from https://blog.unterholzer.dev/cross-compatible-typescript-libraries/
// It basically moves files around so that we can have a separate web and node sdk version in different directories
const proc = require("child_process");
const fs = require("fs");
const path = require("path");

const moveFile = (from, to, filename) => {
  from = from.split("/");
  to = to.split("/");

  if (filename) {
    from.push(filename);
    to.push(filename);
  }

  fs.renameSync(path.resolve(...from), path.resolve(...to));
};

// A deep deletion function for node like `rm -rf` which works for versions older than v14.14
const rimraf = function (directoryPath) {
  if (fs.existsSync(directoryPath)) {
    fs.readdirSync(directoryPath).forEach((file) => {
      const curPath = path.join(directoryPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        // recurse
        rimraf(curPath);
      } else {
        // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(directoryPath);
  }
};

console.log("Building web version...");

// running web build
// building automatically removes any existing 'dist' folder
proc.execSync("yarn run build:web");

// copying into temporary folder
// so it doesn't get overwritten by next build step
moveFile("dist", "dist-web");

console.log("Building node version...");

// running node build
// building automatically removes any existing 'dist' folder
proc.execSync("yarn run build:node");

// create temporary folder 'dist-node' where we move our built node files
fs.mkdirSync(path.resolve("dist-node"));

console.log("Creating common types...");

// Ok, now it's going to be weird
// Let me explain...
// Each build (web and node) contains its own typings
// but this does not make sense, as both typings are exactly the same
// that's why we are disposing one set of typings (node's typings)
// and only use the typings generated along with the web build
// therefore a lot of weird copying and moving is done here...sorry...

// moving all node files into folder 'dist-node'
// reason: we want to get rid of all typings
moveFile("dist", "dist-node", "index.cjs.development.js");
moveFile("dist", "dist-node", "index.cjs.development.js.map");
moveFile("dist", "dist-node", "index.cjs.production.min.js");
moveFile("dist", "dist-node", "index.cjs.production.min.js.map");
moveFile("dist", "dist-node", "index.js");

// finally we delete the folder with all node-typings
rimraf(path.resolve("dist"));
// now we can move 'dist-node' to 'dist/node' again
fs.mkdirSync(path.resolve("dist"));
moveFile("dist-node", "dist/node");

// for our web version, we create a new folder
fs.mkdirSync(path.resolve("dist", "web"));
// moving the important files into 'dist/web' folder
moveFile("dist-web", "dist/web", "index.js");
moveFile("dist-web", "dist/web", "index.js.map");

// typings remain in the temporary folder
// therefore we move and rename it to 'dist/types'
moveFile("dist-web", "dist/types");

// now what's left is copying a template typings file into our subfolders
// that's responsible for linking to folder 'dist/types'
fs.copyFileSync(path.resolve("templates", "index.d.ts"), path.resolve("dist", "web", "index.d.ts"));
fs.copyFileSync(path.resolve("templates", "index.d.ts"), path.resolve("dist", "node", "index.d.ts"));

console.log("Build finished!");
