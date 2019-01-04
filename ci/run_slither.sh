#!/usr/bin/env bash

which python3.6
retVal=$?
if [ $retVal -ne 0 ]
then
    sudo apt update -y && sudo apt upgrade
    wget https://www.python.org/ftp/python/3.6.3/Python-3.6.3.tgz
    tar xvf Python-3.6.3.tgz
    cd Python-3.6.3
    ./configure --enable-optimizations --with-ensurepip=install
    make
    sudo make altinstall
    cd ..
    sudo rm -rf Python-3.6.3.tgz
    sudo rm -rf Python-3.6.3
fi

git clone https://github.com/trailofbits/slither.git
cd slither
sudo python3.6 setup.py install
cd ..
sudo rm -rf slither
npx truffle compile
python3.6 -m slither --truffle-version=latest --exclude=naming-convention,solc-version,pragma,external-function .
