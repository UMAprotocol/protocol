# This script has the following preconditions:
# 1. You have a GCE SSD disk called node-disk with enough space for a parity db.
# 2. node-disk is writable by most/all users (rw filesystem permissions have been granted).
# 3. node-disk contains a folder called io.parity.ethereum (can be empty).

gcloud compute instances create-with-container custom-node \
    --container-image docker.io/openethereum/openethereum:latest \
    --zone northamerica-northeast1-b \
    --container-restart-policy on-failure \
    --container-stdin \
    --scopes cloud-platform \
    --disk=auto-delete=no,name=node-disk \
    --container-mount-disk=mount-path=/node-disk \
    --machine-type n1-standard-2 \
    --container-privileged \
    --container-arg="--chain" \
    --container-arg="mainnet" \
    --container-arg="--ipc-path" \
    --container-arg="./ipc" \
    --container-arg="--warp-barrier" \
    --container-arg="9700000" \
    --container-arg="--no-ancient-blocks" \
    --container-arg="-d" \
    --container-arg="/node-disk/io.parity.ethereum" \
    --container-arg="--ws-interface=all" \
    --container-arg="--jsonrpc-interface=all"
