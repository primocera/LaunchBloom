import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { NoKit, StudioShell, useKits, useRegenerate } from './common';

// ---------------------------------------------------------------------------
// Prompt 23: the Weekly Action Plan. weekly_tasks grouped into the spec's
// sections (this week focus, content / sales / website / review tasks,
// completed), complete checkboxes, edit, add custom task, regenerate, and
// the weekly review questions.
// ---------------------------------------------------------------------------

const GROUPS = [
  ['content', 'Content tasks', /content|post|video|caption|social/i],
  ['sales', 'Sales tasks', /sale|outreach|dm|pitch|offer|client|lead/i],
  ['website', 'Website / landing page tasks', /site|landing|page|seo|web/i],
  ['review', 'Review tasks', /review|reflect|measure|analy/i],
];

// Prompt 23's weekly review questions, verbatim.
const REVIEW_QUESTIONS = [
  'What did I publish?',
  'What got engagement?',
  'Did I mention my offer clearly?',
  'Did I invite people to take action?',
  'What should I improve next week?',
];

export default function WeeklyPlan() {
  const { kits, kitId, setKitId, error: kitsError } = useKits();
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [adding, setAdding] = useState(false);
  const [newTask, setNewTask] = useState({ task_title: '', task_description: '', task_type: 'content', priority: 'medium' });
  const [error, setError] = useState(null);

  function load() {
    if (!kitId) return;
    api.items('weekly_tasks', kitId)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  }

  useEffect(() => { setItems(null); load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kitId]);

  const { regenerate, busy: regenBusy, error: regenError } = useRegenerate(kitId, 'weekly_plan', load);

  async function patch(item, updates) {
    try {
      const r = await api.updateItem('weekly_tasks', item.id, updates);
      setItems((xs) => xs.map((x) => (x.id === item.id ? r.item : x)));
      setEditing(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function addTask() {
    try {
      const r = await api.addWeeklyTask({ ...newTask, launch_kit_id: kitId });
      setItems((xs) => [...xs, r.item]);
      setAdding(false);
      setNewTask({ task_title: '', task_description: '', task_type: 'content', priority: 'medium' });
    } catch (e) {
      setError(e.message);
    }
  }

  const err = error || kitsError || regenError;
  const all = items || [];
  const open = all.filter((i) => !i.completed);
  const completed = all.filter((i) => i.completed);
  const focus = open.filter((i) => i.priority === 'high');
  const groupOf = (i) => GROUPS.find(([, , re]) => re.test(`${i.task_type} ${i.task_title}`))?.[0] || 'content';

  function TaskRow({ i }) {
    return editing === i.id ? (
      <div className="kit-item is-edit" key={i.id}>
        <div style={{ flex: 1 }}>
          {['task_title', 'task_description', 'task_type', 'priority'].map((f) => (
            <label className="flow-field" key={f} style={{ margin: '6px 0' }}>
              <span>{f.replace(/_/g, ' ')}</span>
              <input value={draft[f] ?? i[f] ?? ''} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
            </label>
          ))}
          <div className="flow-row">
            <button className="kit-copy" onClick={() => patch(i, draft)}>Save</button>
            <button className="kit-copy" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      </div>
    ) : (
      <label className={`kit-item task-row ${i.completed ? 'is-done' : ''}`} key={i.id}>
        <input
          type="checkbox"
          checked={!!i.completed}
          onChange={() => patch(i, { completed: !i.completed })}
        />
        <div style={{ flex: 1 }}>
          <div className="kit-item-title">{i.task_title}</div>
          <div className="flow-muted">{i.task_description}</div>
          <div className="kit-item-meta">{[i.task_type, i.priority].filter(Boolean).join(' · ')}</div>
        </div>
        <button className="kit-copy" onClick={(e) => { e.preventDefault(); setEditing(i.id); setDraft({}); }}>Edit</button>
      </label>
    );
  }

  return (
    <StudioShell
      title="Weekly Action Plan"
      blurb="Strategy turned into this week's tasks — check them off as you go."
      kits={kits}
      kitId={kitId}
      onSelectKit={setKitId}
    >
      {err && <p className="flow-err">{err}</p>}
      {kits && !kits.length && <NoKit />}
      {kits && kits.length > 0 && !items && !err && <p className="flow-muted">Loading…</p>}

      {items && (
        <>
          <div className="flow-card studio-toolbar">
            <span className="flow-muted">{completed.length}/{all.length} tasks done</span>
            <div className="flow-row" style={{ marginTop: 0 }}>
              <button className="kit-copy" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add custom task'}</button>
              <button className="kit-copy" disabled={regenBusy} onClick={regenerate}>
                {regenBusy ? 'Regenerating…' : 'Regenerate weekly plan'}
              </button>
            </div>
          </div>

          {adding && (
            <div className="flow-card">
              <h3>New task</h3>
              <label className="flow-field"><span>Title</span>
                <input value={newTask.task_title} onChange={(e) => setNewTask({ ...newTask, task_title: e.target.value })} />
              </label>
              <label className="flow-field"><span>Description</span>
                <input value={newTask.task_description} onChange={(e) => setNewTask({ ...newTask, task_description: e.target.value })} />
              </label>
              <div className="flow-row">
                <select className="studio-select" value={newTask.task_type} onChange={(e) => setNewTask({ ...newTask, task_type: e.target.value })}>
                  {GROUPS.map(([t, label]) => <option key={t} value={t}>{label}</option>)}
                </select>
                <select className="studio-select" value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}>
                  {['high', 'medium', 'low'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button className="flow-btn" style={{ marginTop: 0 }} disabled={!newTask.task_title.trim()} onClick={addTask}>Add task</button>
              </div>
            </div>
          )}

          {focus.length > 0 && (
            <div className="flow-card">
              <h3>This week focus</h3>
              <ul className="kit-checklist">
                {focus.map((i) => <li key={i.id}>{i.task_title}</li>)}
              </ul>
            </div>
          )}

          {GROUPS.map(([type, label]) => {
            const group = open.filter((i) => groupOf(i) === type);
            if (!group.length) return null;
            return (
              <div className="flow-card" key={type}>
                <h3>{label}</h3>
                <div className="kit-items">{group.map((i) => <TaskRow i={i} key={i.id} />)}</div>
              </div>
            );
          })}

          {completed.length > 0 && (
            <div className="flow-card">
              <h3>Completed</h3>
              <div className="kit-items">{completed.map((i) => <TaskRow i={i} key={i.id} />)}</div>
            </div>
          )}

          <div className="flow-card">
            <h3>Weekly review</h3>
            <ul className="kit-checklist">
              {REVIEW_QUESTIONS.map((q) => <li key={q}>{q}</li>)}
            </ul>
          </div>
        </>
      )}
    </StudioShell>
  );
}
