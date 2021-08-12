#!/bin/bash

cat << EOF
  test-integration:
    docker:
      - image: circleci/node:lts
    working_directory: ~/protocol
    resource_class: medium+
    steps:
      - restore_cache:
          key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
      - run:
          name: Install Docker Compose
          command: |
            set -x
            curl -L https://github.com/docker/compose/releases/download/1.11.2/docker-compose-`uname -s`-`uname -m` > /usr/local/bin/docker-compose
            chmod +x /usr/local/bin/docker-compose
      - run:
          name: Run integration tests
          command: |
            yarn optimism-up
            yarn --cwd packages/core test-e2e
EOF
