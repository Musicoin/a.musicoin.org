# Musicoin.org ![Build Status](https://circleci.com/gh/Varunram/musicoin.org.svg?style=shield&circle-token=0fcff59380b4901125cf66e4d37a8a05c03649b1)

## Getting started

 * run `npm install`
 * run `tsc` to compile `ts` to `js`
 * make sure mongo is running
 * `npm start` or `node src/server.js`

## Note:
Please note that all `js` fiels in the directory are autogenerated and **should not** be modified.

## Environment Variables

You will need to set the `GOOGLE_CLIENT_ID` and `GOOGLE_SECRET` environment
variables before authenticating.   

## Musicoin-Frontend

The static front end part is in react and has to be compiled using `npm run build` run inside the musicoin-frontend folder. Once this is done, it has to be manually moved from there to `src/overview/`. To test the frontend part of it as a standalone, run `yarn build` and `yarn start` over at `musicoin-frontend`. To update the submodule recursive stuff, `git submodule update --recursive`

## Typescript

If you are using IntelliJ or Visual Studio Code, you should be
able to turn on auto-compiling and hide the .js files from the
file viewer.  

http://www.typescriptlang.org/

## Server Setup
There are a number of steps needed to get a new server up and running.  

- Install build essentials, which installs `make`, which is required for `letsencrypt-express`
  - `sudo apt-get install build-essential`
- Create a user called `coiner` to run the app
  - the application files should be installed in coiner's home dir
- Install authbind
  - `sudo apt install authbind`
- Setup authbind for user coiner on port 443.  This allows the coiner user to start node and grab ports 80 and 443, which normally needs to be done by root
  - `sudo touch /etc/authbind/byport/443`
  - `sudo chown coiner /etc/authbind/byport/443`
  - `sudo chmod 755 /etc/authbind/byport/443`
- Setup authbind for user coiner on port 80  
  - `sudo touch /etc/authbind/byport/80`
  - `sudo chown coiner /etc/authbind/byport/80`
  - `sudo chmod 755 /etc/authbind/byport/80`
- See `/scripts/deploy` for Jenkins configurations

## Debugging
Checkout Jenkins log for most faults. Worst case, checkout the server log and revert as quickly as possible to avoid downtime
