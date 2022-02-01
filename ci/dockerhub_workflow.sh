#!/bin/bash

cat << EOF
      - docker-publish-latest:
          context: dockerhub-publish
          requires:
            - tests-required
          filters:
            branches:
              only: master
EOF
