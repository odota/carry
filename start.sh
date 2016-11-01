# Install node
curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash - && sudo apt-get install -y nodejs
npm install
PROVIDER=gce ./node_modules/pm2/bin/pm2 start index.js