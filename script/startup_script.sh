#! /bin/bash
if [ ! -f "mc_setup.sh" ]
then
  echo "Starting up for the first time..." >> mc_install.log
  apt-get update

  echo "Installing build essential..." >> mc_install.log
  apt-get install -y build-essential

  echo "Installing mongo db..." >> mc_install.log
  apt install -y mongodb-server

  echo "Installing node..." >> mc_install.log
  curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash -
  apt-get install -y nodejs

  echo "Installing npm..." >> mc_install.log
  apt install -y npm

  echo "Installing pm2..." >> mc_install.log
  npm install -g pm2

  echo "Installing typescript..." >> mc_install.log
  npm install -g typescript

  echo "Installing ipfs..." >> mc_install.log
  wget https://dist.ipfs.io/go-ipfs/v0.4.10/go-ipfs_v0.4.10_linux-amd64.tar.gz
  tar xvfz go-ipfs_v0.4.10_linux-amd64.tar.gz

  echo "Creating setup script ..." >> mc_install.log
  echo "#! /bin/bash" >> mc_setup.sh
  echo "git clone git@github.com:Musicoin/musicoin.org.git" >> mc_setup.sh
  echo "cd musicoin.org" >> mc_setup.sh
  echo "npm install --production" >> mc_setup.sh
  echo "tsc" >> mc_setup.sh
  chmod +x mc_setup.sh

  echo "Generating key for git access ..." >> mc_install.log
  ssh-keygen -t rsa -N "" -f /root/.ssh/github_rsa

  echo "Setting up ~/.ssh/config  ..." >> mc_install.log
  echo "host github.com" >> ~/.ssh/config
  echo " HostName github.com" >> ~/.ssh/config
  echo " IdentityFile ~/.ssh/github_rsa" >> ~/.ssh/config
  echo " User git" >> ~/.ssh/config

  echo "Setting boot script " >> mc_install.log
  echo "cd /" >> /mc_boot.sh
  echo "./go-ipfs/ipfs daemon --init=true --migrate=true >> ipfs.log 2>&1 &" >> /mc_boot.sh
  echo "pm2 start /musicoin.org/src/server.js --max-restarts 10000000" >> /mc_boot.sh
  chmod +x /mc_boot.sh
  echo "@reboot /mc_boot.sh" | crontab

  echo "Done" >> mc_install.log
else
  echo "Rebooting  ..." >> mc_install.log
fi
