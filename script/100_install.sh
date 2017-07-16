#!/bin/bash
{
  echo "Starting up for the first time..."
  apt-get update

  echo "Installing build-essential..."
  apt-get install -y build-essential

  echo "Installing mongo db..."
  apt install -y mongodb-server

  echo "Installing node..."
  curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash -
  apt-get install -y nodejs

  echo "Installing npm..."
  apt install -y npm

  echo "Installing inotify-tools..."
  apt-get install -y inotify-tools

  echo "Installing pm2..."
  npm install -g pm2

  echo "Installing typescript..."
  npm install -g typescript
  npm install -g tsc #Just in case

  echo "Installing ipfs..."
  wget https://dist.ipfs.io/go-ipfs/v0.4.4/go-ipfs_v0.4.4_linux-amd64.tar.gz
  tar xvfz go-ipfs_v0.4.4_linux-amd64.tar.gz

  echo "Making scripts executable..."
  chmod +x /musicoin.org/script/200_boot.sh
  chmod +x /musicoin.org/script/302_update.sh
  chmod +x /musicoin.org/script/watch-file.sh

  echo "Configuring boot script to run on boot..."
  echo "@reboot /musicoin.org/script/200_boot.sh" | crontab

  echo "Adding jenkins user..."
  adduser --disabled-password --gecos "" jenkins

  echo "Done"
} || {
  echo "Failed to initialize install script" | mutt -s "PM2 Error" isaac@musicoin.org
  echo "Failed to initialize install script" | mutt -s "PM2 Error" varunram@musicoin.org
}
