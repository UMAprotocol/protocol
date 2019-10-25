#!/usr/bin/env bash

curl -sSL "https://nodejs.org/dist/v11.5.0/node-v11.5.0-linux-x64.tar.xz" | sudo tar --strip-components=2 -xJ -C /usr/local/bin/ node-v11.5.0-linux-x64/bin/node
curl https://www.npmjs.com/install.sh | sudo bash
