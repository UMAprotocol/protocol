#!/bin/bash

cat << EOF
  test-integration:
    machine:
      image: ubuntu-2004:202010-01
    working_directory: ~/protocol
    resource_class: xlarge
    steps:
      - restore_cache:
          key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
      - run:
          name: Install dependencies
          command: |
            sudo apt update
            sudo apt install nodejs npm
            sudo npm install --global yarn
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
            nvm install 15.10.0
      - run:
          name: Run integration tests
          command: |
            nvm use 15.10.0
            yarn optimism-up
            sleep 120
            yarn --cwd packages/core test-e2e
EOF
