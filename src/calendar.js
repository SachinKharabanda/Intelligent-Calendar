// Calendar data access for the live app: list appointments and execute an action plan
// (src/actions.js). Server-side only, through the Supabase service client.
// STATUS: Implemented, checked only against an in-memory fake (test/calendar.test.js);
// NOT yet run against the live Supabase project.
//
// Errors are rethrown with a generic message so database details never reach the client.

var COLUMNS = 'id, title, person, date, start_time, duration_minutes, source, created_at';

function fail(what) {
  return new Error('Calendar ' + what + ' failed.');
}

// createCalendar(supabase) -> { list(), execute(plan) }
function createCalendar(supabase) {
  return {
    list: async function () {
      var r = await supabase
        .from('appointments')
        .select(COLUMNS)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true });
      if (r.error) throw fail('read');
      return r.data || [];
    },
    execute: async function (plan) {
      var r;
      if (plan.type === 'create') {
        r = await supabase.from('appointments').insert(plan.appointment).select(COLUMNS).single();
      } else if (plan.type === 'cancel') {
        r = await supabase.from('appointments').delete().eq('id', plan.appointment_id);
      } else if (plan.type === 'reschedule') {
        r = await supabase.from('appointments').update(plan.changes).eq('id', plan.appointment_id);
      } else {
        throw new TypeError('Unknown action type.');
      }
      if (r.error) throw fail(plan.type);
      return r.data || null;
    },
  };
}

module.exports = { createCalendar: createCalendar };
