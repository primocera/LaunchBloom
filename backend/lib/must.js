// ---------------------------------------------------------------------------
// must(): a Supabase read whose answer drives a decision (audit D3).
//
// supabase-js reports a failed query in `error`, not by throwing, and about
// 150 reads in this codebase destructure only `data`. For those an outage
// looks exactly like "no row": an export silently drops workspaces, an
// ownership check answers "not ours", a lifecycle email is skipped.
//
//   const row = must(await supabase.from('t').select('x').eq('id', id).single(), 'subscription');
//
// Returns the data (null for a verified "no rows", PGRST116). Any other error
// throws a 503 READ_UNAVAILABLE, so the caller fails closed and the request or
// webhook is retried instead of acting on a guess.
// ---------------------------------------------------------------------------

function must(result, what = 'database read') {
  const { data, error } = result || {};
  if (error && error.code !== 'PGRST116') {
    throw Object.assign(new Error(`${what} unavailable`), {
      status: 503,
      code: 'READ_UNAVAILABLE',
      cause: error,
    });
  }
  return data === undefined ? null : data;
}

module.exports = { must };
