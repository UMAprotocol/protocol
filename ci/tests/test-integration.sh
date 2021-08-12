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
            npm install --global yarn
      - run:
          name: Run integration tests
          command: |
            yarn optimism-up
            yarn --cwd packages/core test-e2e
EOF
