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
          name: Install Docker client
          command: |
            set -x
            curl -L -o /tmp/docker-17.03.0-ce.tgz https://get.docker.com/builds/Linux/x86_64/docker-$VER.tgz
            tar -xz -C /tmp -f /tmp/docker-17.03.0-ce.tgz
            mv /tmp/docker/* /usr/bin
      - run:
          name: Install Docker Compose
          command: |
            set -x
            sudo curl -L https://github.com/docker/compose/releases/download/1.11.2/docker-compose-`uname -s`-`uname -m` > /usr/local/bin/docker-compose
            sudo chmod +x /usr/local/bin/docker-compose
      - run:
          name: Run integration tests
          command: |
            yarn optimism-up
            yarn --cwd packages/core test-e2e
EOF
