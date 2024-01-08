#!/bin/bash

cat << 'EOF'
  docker-publish-latest:
    machine:
      image: ubuntu-2204:2023.10.1
    resource_class: large
    steps:
      - restore_cache:
          key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
      - run:
          name: Build Docker image
          command: |
            cd /home/circleci/protocol
            docker build -t umaprotocol/protocol:latest .
      - run:
          name: Publish Docker Image to Docker Hub
          command: |
            echo $DOCKERHUB_PASS | docker login -u $DOCKERHUB_USERNAME --password-stdin
            docker push umaprotocol/protocol:latest
EOF
