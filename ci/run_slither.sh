#!/usr/bin/env bash

sudo apt update -y
sudo apt install software-properties-common -y
sudo add-apt-repository -y ppa:jonathonf/python-3.6
sudo apt update --allow-unauthenticated --force-yes --yes
sudo apt install python3.6 -y
python3.6 -m pip install --upgrade pip setuptools wheel
git clone https://github.com/trailofbits/slither.git
cd slither
sudo python3.6 setup.py install
cd ..
python3.6 -m slither --exclude=naming-convention,solc-version,pragma,external-function .