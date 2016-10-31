/**
 * File managing configuration for the application
 **/
const dotenv = require('dotenv');
const fs = require('fs');
try
{
  if (fs.statSync('.env'))
    {
    dotenv.load();
  }
}
catch (e)
{
    // Swallow exceptions due to no .env file
}

const defaults = {
  NODE_ENV: 'development',
  PORT: '5600',
  ROOT_URL: 'http://localhost:6000', // base url to redirect to after steam oauth login
  POSTGRES_URL: 'postgresql://postgres:postgres@localhost/yasp', // connection string for PostgreSQL
  POSTGRES_TEST_URL: 'postgresql://postgres:postgres@localhost/yasp_test',
  REDIS_URL: 'redis://127.0.0.1:6379/0', // connection string for Redis
  REDIS_TEST_URL: 'redis://127.0.0.1:6379/1',
  CASSANDRA_URL: 'cassandra://localhost/yasp', // connection string for Cassandra
  CASSANDRA_TEST_URL: 'cassandra://localhost/yasp_test',
  SESSION_SECRET: 'secret to encrypt cookies with', // string to encrypt cookies
  GOAL: 5, // The cheese goal
  ENABLE_POSTGRES_MATCH_STORE_WRITE: '1', // set to enable writing match data to postgres, if off, only pro matches are written
  ENABLE_CASSANDRA_MATCH_STORE_READ: '1', // set to enable reading match data from cassandra
  ENABLE_CASSANDRA_MATCH_STORE_WRITE: '1', // set to enable writing match data to cassandra
  STRIPE_SECRET: '', // for donations, in web
  STRIPE_PUBLIC: '',
  BRAIN_TREE_MERCHANT_ID: '',
  BRAIN_TREE_PUBLIC_KEY: '',
  BRAIN_TREE_PRIVATE_KEY: '',
};
// ensure that process.env has all values in defaults, but prefer the process.env value
for (const key in defaults)
{
  process.env[key] = (key in process.env) ? process.env[key] : defaults[key];
}
if (process.env.NODE_ENV === 'development')
{
    // force PORT to null in development so we can run multiple web services without conflict
  process.env.PORT = '';
}
if (process.env.NODE_ENV === 'test')
{
  process.env.PORT = ''; // use service defaults
  process.env.POSTGRES_URL = process.env.POSTGRES_TEST_URL;
  process.env.CASSANDRA_URL = process.env.CASSANDRA_TEST_URL;
  process.env.REDIS_URL = process.env.REDIS_TEST_URL;
  process.env.SESSION_SECRET = 'testsecretvalue';
}
// now processes can use either process.env or config
module.exports = process.env;
