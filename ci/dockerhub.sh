#!/bin/bash

cat << EOF
  docker-publish-latest:
    docker:
      - image: circleci/buildpack-deps:stretch
    steps:
      - restore_cache:
          key: protocol-completed-build-{{ .Environment.CIRCLE_SHA1 }}
      - run:
          name: Build Docker image
          command: |
            docker build -t umaprotocol/protocol:latest .
      - run:
          name: Publish Docker Image to Docker Hub
          command: |
            echo {{ .Environment.DOCKERHUB_PASS }} | docker login -u {{ .Environment.DOCKERHUB_USERNAME }} --password-stdin
            docker push umaprotocol/protocol:latest
EOF
