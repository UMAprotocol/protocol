#!/usr/bin/env bash

curl -sSL "https://nodejs.org/dist/v14.15.4/node-v14.15.4-linux-x64.tar.xz" | sudo tar --strip-components=2 -xJ -C /usr/local/bin/ node-v12.16.2-linux-x64/bin/node
curl https://www.npmjs.com/install.sh | sudo bash
