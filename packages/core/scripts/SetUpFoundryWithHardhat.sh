if ! command -v forge &> /dev/null
then
    echo "Foundry not installed. Installing foundry for you..."
    curl -L https://foundry.paradigm.xyz | bash
    foundryup
fi

echo "Configuring UMA core to work with foundry std-lib"
mv .gitignore .gitignore.tmp
mkdir temp
cd temp
forge init --force --no-commit
mv ./lib ../
cd ..
rm -rf temp
mv .gitignore.tmp .gitignore
