#!/usr/bin/env bash

cd ~
DIRECTORY=~/Python-3.6.3
if [ ! -d "$DIRECTORY" ]
then
    # Only run when the pre-built python download isn't found.
    echo "Building a fresh Python 3.6..."
    sudo apt update -y && sudo apt upgrade
    wget https://www.python.org/ftp/python/3.6.3/Python-3.6.3.tgz
    tar xvf Python-3.6.3.tgz
    cd $DIRECTORY
    ./configure --enable-optimizations --with-ensurepip=install
    make
    sudo rm -rf Python-3.6.3.tgz
fi

echo "Installing Python 3.6..."
cd $DIRECTORY
sudo make altinstall

echo "Installing Slither..."
cd ~
git clone https://github.com/trailofbits/slither.git
cd slither
sudo python3.6 setup.py install
sudo rm -rf slither

cd ~/protocol
npx truffle compile
python3.6 -m slither --truffle-version=latest
--exclude=naming-convention,solc-version,pragma,external-function,reentrancy-benign .
