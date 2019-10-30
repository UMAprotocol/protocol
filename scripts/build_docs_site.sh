#!/bin/bash
set -e

START_DIR=$(pwd)

rm -rf $START_DIR/build/site
rm -rf $START_DIR/modules
rm -rf $START_DIR/documentation/ui

git clone https://github.com/UMAprotocol/docs_ui.git $START_DIR/documentation/ui
cd $START_DIR/documentation/ui
git checkout master
git pull
npm install
npm run bundle

cd $START_DIR
mkdir -p $START_DIR/modules/ROOT/pages
mkdir -p $START_DIR/modules/contracts/pages

$START_DIR/ci/docgen.sh
cp $START_DIR/docs/*.adoc $START_DIR/modules/contracts/pages/
node $START_DIR/scripts/gen-nav.js $START_DIR/modules/contracts/pages Contracts > $START_DIR/modules/contracts/nav.adoc

shopt -s nullglob
for FNAME in $START_DIR/documentation/tutorials/*.md
do
    BNAME=$(basename "$FNAME" .md)
    pandoc --atx-headers --verbose --wrap=none --toc --reference-links -f gfm -s -o $START_DIR/modules/ROOT/pages/$BNAME.adoc -t asciidoc $FNAME
done

node $START_DIR/scripts/gen-nav.js $START_DIR/modules/ROOT/pages Tutorials > $START_DIR/modules/ROOT/nav.adoc

pandoc --atx-headers --verbose --wrap=none --toc --reference-links -f gfm -s -o $START_DIR/modules/ROOT/pages/index.adoc -t asciidoc $START_DIR/documentation/intro.md
$(npm bin)/antora playbook.yml

