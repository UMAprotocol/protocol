#!/bin/bash
set -e

md_to_adoc() {
    # Input filename
    local infile=$1

    # Output filename
    local outfile=$2

    # Depth of file in tree.
    local depth=$3

    # Create temporary file for intermediate step.
    local tmpfile=$(mktemp)

    # Copy the markdown to a tempfile that can be freely modified.
    cp $infile $tmpfile

    # Note: the .bak file is only generated because this is the only BSD/GNU compatible way to do an in place sed.
    # Changes markdown headers so they are correctly converted to the right level in asciidoc.
    sed -i.bak 's/^#[[:space:]]/= /' $tmpfile
    sed -i.bak 's/^##/#/' $tmpfile

    # Changes markdown file interlink extensions to .html so they continue to work when the site is rendered.
    sed -i.bak 's/\(\](\.\{0,2\}[^).]*\)\.md\([)#]\)/\1.html\2/g' $tmpfile

    # Changes all dashes to underscores inside the anchors.
    sed -i.bak -e ':loop' -e 's/\(\]([^)]*#[^)]*\)-\([^)]*)\)/\1_\2/g' -e 't loop' $tmpfile

    # Adds a leading underscore to same-file anchors.
    sed -i.bak 's/\](#/\](#_/g' $tmpfile

    # Adds a leading underscore to outside-file anchors.
    sed -i.bak 's/\.html#/.html#_/g' $tmpfile

    # For each level of depth below the module level, we need to remove one "../" from file references. This is because
    # subdirectories effectively get flattened into the modules general file list.
    for ((n=0;n<$depth;n++))
    do
        sed -i.bak 's/(\.\.\//(/' $tmpfile
    done

    # Because the antora directory structure is flattened, we need to strip directories deeper than the module level.
    # This sed takes links that look like "../module/deeper_dir/file.html" and transforms them to "../module/file.html".
    sed -i.bak 's/\(\](\.\.\/[[:alnum:]_-]*\/\)[^.)]*\/\([[:alnum:]_-]*.html\)/\1\2/g' $tmpfile

    # Similar to the last sed except that it handles links that don't start with "../".
    # This sed takes links that look like "(./)deeper_dir/file.html" and transforms them to "file.html".
    sed -i.bak 's/\]([.]\{0,1\}[^.][^).]*\/\([[:alnum:]_-]*.html\)/](\1/g' $tmpfile

    # If the file is in the ROOT directory, then we need to remove all of the leading "../" from links.
    if [[ $infile = *ROOT* ]]
    then
        sed -i.bak 's/\](\.\.\//](/g' $tmpfile
    fi

    # Use pandoc to do the remainder of the conversion and output to the destination.
    pandoc --atx-headers --verbose --wrap=none --toc --reference-links -f gfm -s -o $outfile -t asciidoc $tmpfile
}

START_DIR=$(pwd)

rm -rf $START_DIR/build/site
rm -rf $START_DIR/modules
rm -rf $START_DIR/documentation/ui
rm -rf $START_DIR/antora.yml

# Move the script into the documentation directory so the relative paths produced by find only include dirs below documentation/.
cd $START_DIR/documentation
for FNAME in $(find . -name '*.md');
do
    MODULE_DIR=$(echo "$FNAME" | cut -d "/" -f2)
    mkdir -p $START_DIR/modules/$MODULE_DIR/pages
    BNAME=$(basename "$FNAME" .md)
    # Determine the depth.
    SLASH_COUNT=$(echo $FNAME | grep -o '/' | wc -l)
    DEPTH="$(($SLASH_COUNT-2))"
    md_to_adoc $FNAME $START_DIR/modules/$MODULE_DIR/pages/$BNAME.adoc $DEPTH
done

# Find images and put them into the appropriate image folder.
for FNAME in $(find . \( -name '*.png' -or -name '*.jpeg' -or -name '*.jpg' \));
do
    MODULE_DIR=$(echo "$FNAME" | cut -d "/" -f2)
    mkdir -p $START_DIR/modules/$MODULE_DIR/assets/images
    cp $FNAME $START_DIR/modules/$MODULE_DIR/assets/images/
done

cd $START_DIR

# Generate contract documentation.
mkdir -p $START_DIR/modules/contracts/pages
$START_DIR/ci/docgen.sh
find $START_DIR/docs -name "*.adoc" -exec cp '{}' $START_DIR/modules/contracts/pages/ \;

# Initialize antora.yml
cat > $START_DIR/antora.yml << EOF
name: uma
title: UMA
version: master
nav:
EOF

# This unintuitive command just grabs only the lines that look like:
# * some_dirname
# and turn them into lines that look like:
#   - modules/some_dirname/nav.adoc
grep "^* " $START_DIR/documentation/map.txt | cut -c3- | sed 's/\(.*\)/  - modules\/\1\/nav.adoc/' >> $START_DIR/antora.yml

cd $START_DIR/modules
# We have to exclude ROOT because it's treated differently.
for DIRNAME in $(find . -type d \( -name 'pages' -and ! -path '*/ROOT/*' \));
do
    CONTAINING_DIR=$(dirname "$DIRNAME")
    node $START_DIR/scripts/gen-nav.js $START_DIR/documentation/map.txt $DIRNAME > $START_DIR/modules/$CONTAINING_DIR/nav.adoc
done

touch $START_DIR/modules/ROOT/nav.adoc

git clone https://github.com/UMAprotocol/docs_ui.git $START_DIR/documentation/ui
cd $START_DIR/documentation/ui
git checkout master
git pull
npm install
npm run bundle

cd $START_DIR
$(npm bin)/antora playbook.yml

