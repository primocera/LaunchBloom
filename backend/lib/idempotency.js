// ---------------------------------------------------------------------------
// Generation idempotency (playbook v6, Prompt 11). Clients send an
// `Idempotency-Key` header per generation INTENT (one UUID per click, reused
// on retry). Semantics:
//
//   - first request:      claims the key (unique row), runs the route,
//                          stores the JSON response for replays
//   - repeat, succeeded:  returns the stored response — no provider call,
//                          no quota reservation (mounted BEFORE planGate)
//   - repeat, in flight:  409 IN_PROGRESS — the client polls/retries
//   - repeat, failed:     takes the claim over and re-runs (failures are
//                          retryable; quota was already released)
//   - orphaned in flight: rows older than ORPHAN_MS are treated as failed
//                          (serverless timeout died mid-run) and re-runnable
//
// No header → passthrough (backwards compatible). If the migration hasn't
// been applied, claims fail open with a warning — behavior degrades to the
// pre-idempotency world rather than blocking generation.
// ---------------------------------------------------------------------------

const supabase = require('./supabase');
const { requireAuth } = require('./auth');

const ORPHAN_MS = Number(process.env.IDEMPOTENCY_ORPHAN_MS || 10 * 60 * 1000);

function isMissingTable(error) {
  const msg = String((error && error.message) || '');
  return (error && error.code === '42P01') || /relation .* does not exist|could not find the table/i.test(msg);
}

function idempotent(route) {
  return function (req, res, next) {
    requireAuth(req, res, async () => {
      const key = req.get('idempotency-key');
      if (!key || key.length > 128) return next();

      try {
        // Try to claim the key (unique on user_id + idempotency_key).
        const { error: insErr } = await supabase
          .from('generation_jobs')
          .insert({ user_id: req.userId, idempotency_key: key, route, status: 'in_flight' });

        if (insErr) {
          if (isMissingTable(insErr)) {
            console.warn('[idempotency] generation_jobs missing — apply migration 026; passing through');
            return next();
          }
          // Key exists — decide from the stored row.
          const { data: job } = await supabase
            .from('generation_jobs')
            .select('*')
            .eq('user_id', req.userId)
            .eq('idempotency_key', key)
            .single();

          if (job && job.status === 'succeeded') {
            res.set('Idempotency-Replayed', 'true');
            return res.status(job.http_status || 200).json(job.result);
          }
          const stale = job && job.status === 'in_flight' &&
            Date.now() - new Date(job.created_at).getTime() > ORPHAN_MS;
          if (job && job.status === 'in_flight' && !stale) {
            return res.status(409).json({
              error: 'This generation is still running. Please wait for it to finish.',
              code: 'IN_PROGRESS',
            });
          }
          // failed or orphaned → take the claim over and re-run.
          await supabase
            .from('generation_jobs')
            .update({ status: 'in_flight', http_status: null, result: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('user_id', req.userId)
            .eq('idempotency_key', key);
        }

        // Capture the JSON response so replays can return it verbatim.
        const origJson = res.json.bind(res);
        res.json = (body) => {
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          supabase
            .from('generation_jobs')
            .update({
              status: ok ? 'succeeded' : 'failed',
              http_status: res.statusCode,
              result: ok ? body : null, // never store error bodies for replay
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', req.userId)
            .eq('idempotency_key', key)
            .then(() => {}, () => {});
          return origJson(body);
        };

        next();
      } catch (err) {
        // Idempotency must never take generation down.
        console.error('[idempotency] claim failed:', err.message);
        next();
      }
    });
  };
}

module.exports = { idempotent };
