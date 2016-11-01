const cp = require('child_process');
if (process.env.PROVIDER === 'gce') {
  cp.execSync('curl -H "Metadata-Flavor: Google" -L http://metadata.google.internal/computeMetadata/v1/project/attributes/env > /usr/src/.env');
}

require('./index.js');