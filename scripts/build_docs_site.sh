#!/bin/bash
set -e

md_to_adoc() {
    # Input filename
    local infile=$1

    # Output filename
    local outfile=$2

    # Create temporary file for intermediate step.
    local tmpfile=$(mktemp)

    # Copy the markdown to a tempfile that can be freely modified.
    cp $infile $tmpfile

    # Note: the .bak file is only generated because this is the only BSD/GNU compatible way to do an in place sed.
    # Changes markdown headers so they are correctly converted to the right level in asciidoc.
    sed -i.bak 's/^#[[:space:]]/= /' $tmpfile
    sed -i.bak 's/^##/#/' $tmpfile

    # Changes markdown file interlink extensions to .html so they continue to work when the site is rendered.
    sed -i.bak 's/\.md)/.html)/' $tmpfile

    # Use pandoc to do the remainder of the conversion and output to the destination.
    pandoc --atx-headers --verbose --wrap=none --toc --reference-links -f gfm -s -o $outfile -t asciidoc $tmpfile
}

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
mkdir -p $START_DIR/modules/explainers/pages
mkdir -p $START_DIR/modules/explainers/assets/images
mkdir -p $START_DIR/modules/contracts/pages

cp $START_DIR/documentation/explainers/*.jpeg $START_DIR/modules/explainers/assets/images/

$START_DIR/ci/docgen.sh
cp $START_DIR/docs/*.adoc $START_DIR/modules/contracts/pages/
node $START_DIR/scripts/gen-nav.js $START_DIR/modules/contracts/pages Contracts > $START_DIR/modules/contracts/nav.adoc

shopt -s nullglob
for FNAME in $START_DIR/documentation/tutorials/*.md
do
    BNAME=$(basename "$FNAME" .md)
    md_to_adoc $FNAME $START_DIR/modules/ROOT/pages/$BNAME.adoc
done

for FNAME in $START_DIR/documentation/explainers/*.md
do
    BNAME=$(basename "$FNAME" .md)
    md_to_adoc $FNAME $START_DIR/modules/explainers/pages/$BNAME.adoc
done

node $START_DIR/scripts/gen-nav.js $START_DIR/modules/ROOT/pages Tutorials > $START_DIR/modules/ROOT/nav.adoc
node $START_DIR/scripts/gen-nav.js $START_DIR/modules/explainers/pages Explainers > $START_DIR/modules/explainers/nav.adoc

md_to_adoc $START_DIR/documentation/intro.md $START_DIR/modules/ROOT/pages/index.adoc
$(npm bin)/antora playbook.yml

