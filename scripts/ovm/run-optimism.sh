#!/bin/bash

# download pre-builted images
# repo="ethereumoptimism"
#   for image in {\
#       builder,\
#       l2geth,\
#       deployer,\
#       data-transport-layer,\
#       hardhat,\
#       batch-submitter,\
#       message-relayer\
#       };\
#   do docker pull $repo/$image;\
# done

# # build in 2 steps
# function build_images() {
#   docker-compose build --parallel --
#   docker-compose build --parallel -- relayer
# }

for image_build in {\
  builder,\
  l1_chain,\
  deployer,\
  dtl,\
  l2geth,\
  relayer,\
  batch_submitter,\
  };\
do docker-compose build --parallel -- $image_build;\
done

# clones /optimism to current directory
git clone https://github.com/ethereum-optimism/optimism.git
cd optimism/ops
git checkout master

# Use 1B gas for the block gas limit
sed -i  's/TARGET_GAS_LIMIT=11000000/TARGET_GAS_LIMIT=1000000000/g' envs/geth.env

# enabling the Docker BuildKit is recommended
export COMPOSE_DOCKER_CLI_BUILD=1
export DOCKER_BUILDKIT=1

# build_images. This will take a long time!
#docker-compose build
docker-compose up -d

# Optionally print logs:
# docker-compose logs --follow l2geth

# get back to original directory
cd ../..
