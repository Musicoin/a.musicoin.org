#!/bin/bash

echo "Pulling changes from git..."
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

echo "Compiling type script ..."
{
  tsc
} || {
  echo "Failed to Compile Typescript" | mutt -s "TypeScript Error" isaac@musicoin.org
  echo "Failed to Compile Typescript" | mutt -s "TypeScript Error" varunram@musicoin.org
}

echo "Restarting pm2 processes..."
{
  pm2 restart server
} || {
  echo "Failed to restart pm2" | mutt -s "PM2 Error" isaac@musicoin.org
  echo "Failed to restart pm2" | mutt -s "PM2 Error" varunram@musicoin.org
}

echo "Done."
