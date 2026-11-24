// Appointment CRUD (status: Implemented). Fields and constraints mirror
// supabase/schema.sql -> public.appointments. Database access is server-side
// only, through src/supabase.js (service-role key never leaves the server).
var express = require('express');
var router = express.Router();
var supabase = require('../../src/supabase');

var COLUMNS = 'id, title, person, date, start_time, duration_minutes, source, created_at';
var SOURCES = ['app', 'simulation'];
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

function isRealDate(s) {
  var m = DATE_RE.exec(s);
  if (!m) return false;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// Validate a body. When `partial` is true (PUT) only supplied fields are
// checked; otherwise required fields (title, date, start_time) must be present.
// Returns { values } or { errors }.
function validate(body, partial) {
  var errors = [];
  var v = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: ['Request body must be a JSON object.'] };
  }
  var allowed = ['title', 'person', 'date', 'start_time', 'duration_minutes', 'source'];
  Object.keys(body).forEach(function (k) {
    if (allowed.indexOf(k) === -1) errors.push('Unknown field: ' + k + '.');
  });

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim() === '') errors.push('title must be a non-empty string.');
    else v.title = body.title.trim();
  } else if (!partial) errors.push('title is required.');

  if (body.person !== undefined) {
    if (body.person === null) v.person = null;
    else if (typeof body.person !== 'string' || body.person.trim() === '') errors.push('person must be a non-empty string or null.');
    else v.person = body.person.trim();
  }

  if (body.date !== undefined) {
    if (typeof body.date !== 'string' || !isRealDate(body.date)) errors.push('date must be a valid YYYY-MM-DD date.');
    else v.date = body.date;
  } else if (!partial) errors.push('date is required.');

  if (body.start_time !== undefined) {
    if (typeof body.start_time !== 'string' || !TIME_RE.test(body.start_time)) errors.push('start_time must be HH:MM or HH:MM:SS (24h).');
    else v.start_time = body.start_time;
  } else if (!partial) errors.push('start_time is required.');

  if (body.duration_minutes !== undefined) {
    if (!Number.isInteger(body.duration_minutes) || body.duration_minutes <= 0) errors.push('duration_minutes must be a positive integer.');
    else v.duration_minutes = body.duration_minutes;
  }

  if (body.source !== undefined) {
    if (SOURCES.indexOf(body.source) === -1) errors.push('source must be one of: ' + SOURCES.join(', ') + '.');
    else v.source = body.source;
  }

  if (partial && errors.length === 0 && Object.keys(v).length === 0) {
    errors.push('Provide at least one field to update.');
  }
  return errors.length ? { errors: errors } : { values: v };
}

// Generic 500: log only the database error message server-side, never return
// it (or any config) to the client.
function dbFailure(res, error) {
  console.error('appointments: database error:', error && error.message);
  return res.status(500).json({ error: 'Internal server error.' });
}

function badId(res) {
  return res.status(400).json({ error: 'id must be a valid UUID.' });
}

// GET /api/appointments?date=YYYY-MM-DD&person=Name  (both filters optional)
router.get('/', async function (req, res) {
  var q = req.query;
  if (q.date !== undefined && (typeof q.date !== 'string' || !isRealDate(q.date))) {
    return res.status(400).json({ errors: ['date must be a valid YYYY-MM-DD date.'] });
  }
  if (q.person !== undefined && (typeof q.person !== 'string' || q.person.trim() === '')) {
    return res.status(400).json({ errors: ['person must be a non-empty string.'] });
  }
  try {
    var query = supabase.from('appointments').select(COLUMNS).eq('session_id', req.sessionId);
    if (q.date !== undefined) query = query.eq('date', q.date);
    if (q.person !== undefined) query = query.eq('person', q.person.trim());
    var r = await query.order('date').order('start_time');
    if (r.error) return dbFailure(res, r.error);
    res.json(r.data);
  } catch (e) {
    dbFailure(res, e);
  }
});

// POST /api/appointments  -> 201 with the created row
router.post('/', async function (req, res) {
  var result = validate(req.body, false);
  if (result.errors) return res.status(400).json({ errors: result.errors });
  try {
    var r = await supabase.from('appointments').insert(Object.assign({}, result.values, { session_id: req.sessionId })).select(COLUMNS).single();
    if (r.error) return dbFailure(res, r.error);
    res.status(201).json(r.data);
  } catch (e) {
    dbFailure(res, e);
  }
});

// PUT /api/appointments/:id  -> partial update (reschedule); 404 if no such row
router.put('/:id', async function (req, res) {
  if (!UUID_RE.test(req.params.id)) return badId(res);
  var result = validate(req.body, true);
  if (result.errors) return res.status(400).json({ errors: result.errors });
  try {
    var r = await supabase
      .from('appointments')
      .update(result.values)
      .eq('id', req.params.id)
      .eq('session_id', req.sessionId)
      .select(COLUMNS)
      .maybeSingle();
    if (r.error) return dbFailure(res, r.error);
    if (!r.data) return res.status(404).json({ error: 'Appointment not found.' });
    res.json(r.data);
  } catch (e) {
    dbFailure(res, e);
  }
});

// DELETE /api/appointments/:id  -> deletes exactly that row (cancel); 404 if none
router.delete('/:id', async function (req, res) {
  if (!UUID_RE.test(req.params.id)) return badId(res);
  try {
    var r = await supabase
      .from('appointments')
      .delete()
      .eq('id', req.params.id)
      .eq('session_id', req.sessionId)
      .select(COLUMNS)
      .maybeSingle();
    if (r.error) return dbFailure(res, r.error);
    if (!r.data) return res.status(404).json({ error: 'Appointment not found.' });
    res.json(r.data);
  } catch (e) {
    dbFailure(res, e);
  }
});

module.exports = router;
