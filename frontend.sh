git submodule init
git submodule update
rm -rf src/overview/
cd musicoin-frontend/
rm -rf build/
npm install
npm run build
cp -r build/ ../src/overview/
cd ..
