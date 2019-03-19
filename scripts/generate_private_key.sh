#!/usr/bin/env bash
set -e

# Note: this script should be run from inside the ubuntu docker container with this
# repository mounted at ~/protocol.
# An example run command would look like the following:
# docker run -v `pwd`:/protocol -v <DEST_DIR>:/keys -w /protocol ubuntu scripts/generate_private_key.sh

apt-get update && apt-get install -y git make gcc

cd /
git clone https://github.com/maandree/libkeccak
cd libkeccak

# Checkout a specific hash to avoid code contamination later.
git checkout 47139985115e175ed9c3f7d648d6d9ec7c48b89b
make
make install PREFIX=/usr


cd /
git clone https://github.com/maandree/sha3sum.git
cd sha3sum

# Checkout a specific hash to avoid code contamination later.
git checkout e17cf813fa38fbc13df6dbecdad5e6d0e8223ba2
make
make install

DEST_DIR=/keys
cd $DEST_DIR

# Everything below was shamelessly stolen from https://kobl.one/blog/create-full-ethereum-keypair-and-address/.
# Generate the private and public keys
openssl ecparam -name secp256k1 -genkey -noout | openssl ec -text -noout > Key

# Extract the public key and remove the EC prefix 0x04
cat Key | grep pub -A 5 | tail -n +2 | tr -d '\n[:space:]:' | sed 's/^04//' > pub

# Extract the private key and remove the leading zero byte
cat Key | grep priv -A 3 | tail -n +2 | tr -d '\n[:space:]:' | sed 's/^00//' > priv

# Generate the hash and take the address part
cat pub | keccak-256sum -x -l | tr -d ' -' | tail -c 41 > address
