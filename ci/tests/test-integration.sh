#!/bin/bash

cat << EOF
  test-integration:
    machine:
      image: ubuntu-2004:202010-01
    working_directory: ~/protocol
    steps:
      - restore_cache:
          key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
      - run:
          name: Install dependencies
          command: |
            sudo apt update
            sudo apt install nodejs npm
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
            nvm install 15.10.0
            nvm use 15.10.0
            sudo npm install --global yarn
      - run:
          name: Run integration tests
          command: |
            node -v
            npm -v
            yarn -v
            yarn optimism-up
            sleep 60
            yarn --cwd packages/core test-e2e
EOF
