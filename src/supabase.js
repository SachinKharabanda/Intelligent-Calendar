// Supabase client (server-side only; service-role key never sent to the browser).
require('dotenv').config();
var createClient = require('@supabase/supabase-js').createClient;

var url = process.env.SUPABASE_URL;
var serviceKey = process.env.SUPABASE_SERVICE_KEY;

var missing = [];
if (!url) missing.push('SUPABASE_URL');
if (!serviceKey) missing.push('SUPABASE_SERVICE_KEY');
if (missing.length > 0) {
  throw new Error(
    'Supabase client not configured: missing environment variable(s): ' +
      missing.join(', ') +
      '. Copy .env.example to .env and fill in the values (see README).'
  );
}

// persistSession/autoRefresh are irrelevant for a server-side service client.
var supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = supabase;
