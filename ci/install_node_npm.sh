#!/usr/bin/env bash

curl -sSL "https://nodejs.org/dist/v13.8.0/node-v13.8.0-linux-x64.tar.xz" | sudo tar --strip-components=2 -xJ -C /usr/local/bin/ node-v13.8.0-linux-x64/bin/node
curl https://www.npmjs.com/install.sh | sudo bash
