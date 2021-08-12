#!/bin/bash

cat << EOF
  test-integration:
    machine:
      image: ubuntu-2004:202010-01
    steps:
      - restore_cache:
          key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
      - run:
          name: Run integration tests
          command: |
            sudo apt update
            sudo apt install nodejs
            sudo apt install npm
            npm install --global yarn
            yarn optimism-up
            yarn --cwd packages/core test-e2e
EOF
