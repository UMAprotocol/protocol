#!/usr/bin/env bash

# This script has the following preconditions:
# 1. You have a GCE SSD disk called node-disk with enough space for a geth db.
# 2. node-disk is writable by most/all users (rw filesystem permissions have been granted).
# 3. node-disk contains a folder called ethereum (can be empty).

gcloud compute instances create-with-container geth-node \
    --container-image docker.io/ethereum/client-go \
    --zone northamerica-northeast1-b \
    --container-restart-policy on-failure \
    --container-stdin \
    --scopes cloud-platform \
    --disk=auto-delete=no,name=node-disk \
    --container-mount-disk=mount-path=/node-disk \
    --machine-type n1-highmem-8 \
    --container-privileged \
    --container-arg="--rpc" \
    --container-arg="--rpcaddr" \
    --container-arg="0.0.0.0" \
    --container-arg="--ws" \
    --container-arg="--wsaddr" \
    --container-arg="0.0.0.0" \
    --container-arg="--ipcdisable" \
    --container-arg="--datadir" \
    --container-arg="/node-disk/ethereum"
