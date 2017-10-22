#!/bin/bash

echo "Pulling changes from git..."
echo $(date)
cd /musicoin.org

{
  git pull
} || {
  echo "Failed to pull from GitHub" | mutt -s "PM2 Error" isaac@musicoin.org
  echo "Failed to pull from GitHub" | mutt -s "PM2 Error" varunram@musicoin.org
}

echo "Running npm install..."
{
  npm install --production
} || {
  echo "Failed to Run npm install" | mutt -s "Npm Error" isaac@musicoin.org
  echo "Failed to Run npm install" | mutt -s "Npm Error" varunram@musicoin.org
}

echo "Updating front-end submodule"
chmod +x frontend.sh
./frontend.sh

echo "Compiling type script ..."
{
  tsc
} || {
  echo "Failed to Compile Typescript" | mutt -s "TypeScript Error" isaac@musicoin.org
  echo "Failed to Compile Typescript" | mutt -s "TypeScript Error" varunram@musicoin.org
}

echo "Restarting pm2 processes..."
{
  pm2 restart all
} || {
  echo "Failed to restart pm2" | mutt -s "PM2 Error" isaac@musicoin.org
  echo "Failed to restart pm2" | mutt -s "PM2 Error" varunram@musicoin.org
}

echo "Done."
