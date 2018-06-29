# In case the website is down
sudo su
# Root on main server
lxc exec musicoin -- /bin/bash
# Access the container
su www-data
# switch to www-data to avoid ownership problems
cd
# pwd: /var/www/
cd tmpfs/running-master/
# If this doesn't exist, mkdir -p tmpfs/running-master to create
rm -rf musicoin.org
# Delete this no matter what
git pull https://github.com/Musicoin/musicoin.org/
cd musicoin.org
npm install
sh frontend.sh
tsc
exit
systemctl stop mcorg ; systemctl start mcorg
