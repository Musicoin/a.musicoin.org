#!/bin/bash
# * * * * * /restart_cron.sh
main_server="node"
logfile=main_server_restart.log
logfilePath=/$logfile
main_server_running=0
check_main_server (){
  if (( $(ps -ef | grep -v grep | grep "node" | wc -l) <= 0 ))
 then
    echo "DANGER"
    sudo pm2 start /musicoin.org/src/server.js --max-restarts 10000000 # restart the server
    echo `date` "$main_server was stopped... Restarting" >> $logfilePath
    echo "************************************************" >> $logfilePath
    #Send email to notify that the script ran
    echo "$(date) $main_server was restarted from Main Server. Stack trace is: \n `cat /root/.pm2/logs/server-error-0.log`" | mutt -s "Website Restarted via pm2" v$
    echo "$(date) $main_server was restarted from Main Server. " | mutt -s "Website Restarted via pm2" varunramganesh@gmail.com
    echo "$(date) $main_server was restarted from Main Server. Stack trace is: \n `cat /root/.pm2/logs/server-error-0.log`" | mutt -s "Website Restarted via pm2" i$
  else
    let main_server_running=1
  fi
}
main_loop (){
  until ((main_server_running == 1));
  do
    check_main_server
    sleep 1.5
  done
}
main_loop
