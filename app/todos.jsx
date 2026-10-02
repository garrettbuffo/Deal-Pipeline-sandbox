// app/todos.jsx — full-page TodoView + compact DealTodos widget
const { useState: useST, useRef: useRT, useEffect: useET } = React;

const PRIO_META = {
  high:   { label: 'High',   c: '#c93c40', bg: '#fce8e8' },
  normal: { label: 'Normal', c: '#5b7088', bg: '#eef1f5' },
};

function todayStr() { return window.ALTUS_TODAY || new Date().toISOString().slice(0, 10); }

/* ── single todo row ── */
function TodoRow({ todo, deals, onPatch, onDelete, compact }) {
  const [editing, setEditing] = useST(false);
  const [draft, setDraft] = useST(todo.text);
  const inputRef = useRT(null);
  const deal = deals && todo.dealId ? deals.find((d) => d.id === todo.dealId) : null;

  const commit = () => {
    const t = draft.trim();
    if (t) onPatch(todo.id, { text: t });
    else onDelete(todo.id);
    setEditing(false);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: compact ? '7px 0' : '9px 0',
      borderBottom: '1px solid var(--line)',
      opacity: todo.done ? 0.5 : 1,
      transition: 'opacity .15s',
    }}>
      {/* checkbox */}
      <button onClick={() => onPatch(todo.id, { done: !todo.done, completedAt: !todo.done ? todayStr() : null })}
        style={{ flex: 'none', width: 18, height: 18, borderRadius: 5,
          border: todo.done ? 'none' : '1.5px solid var(--line-2)',
          background: todo.done ? 'var(--accent)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', marginTop: 1 }}>
        {todo.done && <Icon name="check" size={11} style={{ color: '#fff', strokeWidth: 3 }} />}
      </button>

      {/* text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(todo.text); setEditing(false); } }}
            style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent',
              fontSize: compact ? 13 : 13.5, color: 'var(--ink)', fontFamily: 'var(--font)', padding: 0 }}
            autoFocus />
        ) : (
          <div onClick={() => { setEditing(true); setDraft(todo.text); }}
            style={{ fontSize: compact ? 13 : 13.5, color: 'var(--ink)', cursor: 'text',
              textDecoration: todo.done ? 'line-through' : 'none', lineHeight: 1.4,
              wordBreak: 'break-word' }}>
            {todo.text}
          </div>
        )}
        {/* meta row */}
        {(!compact || deal || todo.dueDate) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
            {deal && (
              <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999,
                background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 500 }}>
                {deal.name}
              </span>
            )}
            {todo.dueDate && (
              <span style={{ fontSize: 11, color: todo.dueDate < todayStr() && !todo.done ? 'var(--neg)' : 'var(--muted)' }}>
                Due {new Date(todo.dueDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
            {todo.priority === 'high' && !todo.done && (
              <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 999,
                background: PRIO_META.high.bg, color: PRIO_META.high.c, fontWeight: 600 }}>High</span>
            )}
          </div>
        )}
      </div>

      {/* actions */}
      {!compact && (
        <div style={{ display: 'flex', gap: 2, flex: 'none', opacity: 0.4 }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
          onMouseLeave={(e) => e.currentTarget.style.opacity = .4}>
          <button onClick={() => onPatch(todo.id, { priority: todo.priority === 'high' ? 'normal' : 'high' })}
            title={todo.priority === 'high' ? 'Mark normal' : 'Mark high priority'}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 3,
              color: todo.priority === 'high' ? 'var(--neg)' : 'var(--muted)' }}>
            <Icon name="flag" size={13} />
          </button>
          <button onClick={() => onDelete(todo.id)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 3, color: 'var(--muted)' }}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      )}
      {compact && (
        <button onClick={() => onDelete(todo.id)}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 3,
            color: 'var(--muted)', opacity: 0.4, flex: 'none' }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
          onMouseLeave={(e) => e.currentTarget.style.opacity = .4}>
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  );
}

/* ── inline add-todo row ── */
function AddTodoRow({ onAdd, dealId, deals, compact, placeholder }) {
  const [text, setText] = useST('');
  const [dueDate, setDueDate] = useST('');
  const [priority, setPriority] = useST('normal');
  const [linkDeal, setLinkDeal] = useST(dealId || '');
  const [expanded, setExpanded] = useST(false);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd({ id: 'todo-' + Date.now(), text: t, done: false,
      dealId: linkDeal || null, priority, dueDate: dueDate || null,
      createdAt: todayStr(), completedAt: null });
    setText(''); setDueDate(''); setPriority('normal');
    if (!dealId) setLinkDeal('');
    setExpanded(false);
  };

  return (
    <div style={{ marginBottom: compact ? 8 : 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ width: 18, flex: 'none' }} />
        <input value={text} onChange={(e) => setText(e.target.value)}
          onFocus={() => setExpanded(true)}
          placeholder={placeholder || 'Add a task…'}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setText(''); setExpanded(false); } }}
          style={{ flex: 1, border: 'none', borderBottom: '1.5px solid var(--line-2)',
            outline: 'none', background: 'transparent', fontSize: compact ? 13 : 13.5,
            color: 'var(--ink)', fontFamily: 'var(--font)', padding: '5px 0',
            transition: 'border-color .12s' }}
          onMouseEnter={(e) => e.target.style.borderColor = 'var(--accent)'}
          onMouseLeave={(e) => { if (document.activeElement !== e.target) e.target.style.borderColor = 'var(--line-2)'; }}
        />
        {text && (
          <button onClick={submit} style={{ flex: 'none', border: 'none',
            background: 'var(--accent)', color: '#fff', borderRadius: 6,
            padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            Add
          </button>
        )}
      </div>
      {expanded && !compact && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, paddingLeft: 26, flexWrap: 'wrap' }}>
          {!dealId && deals && deals.length > 0 && (
            <select value={linkDeal} onChange={(e) => setLinkDeal(e.target.value)}
              style={{ border: '1px solid var(--line-2)', borderRadius: 6, padding: '4px 8px',
                background: 'var(--panel)', fontSize: 12, color: 'var(--ink)', maxWidth: 200 }}>
              <option value="">No deal linked</option>
              {deals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <select value={priority} onChange={(e) => setPriority(e.target.value)}
            style={{ border: '1px solid var(--line-2)', borderRadius: 6, padding: '4px 8px',
              background: 'var(--panel)', fontSize: 12, color: 'var(--ink)' }}>
            <option value="normal">Normal priority</option>
            <option value="high">High priority</option>
          </select>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            style={{ border: '1px solid var(--line-2)', borderRadius: 6, padding: '4px 8px',
              background: 'var(--panel)', fontSize: 12, color: 'var(--ink)' }} />
        </div>
      )}
    </div>
  );
}

/* ── compact deal-level widget (shown on deal summary tab) ── */
function DealTodos({ deal, todos, onAdd, onPatch, onDelete, onViewAll }) {
  const mine = todos.filter((t) => t.dealId === deal.id);
  const open = mine.filter((t) => !t.done);
  const done = mine.filter((t) => t.done);

  return (
    <div>
      <AddTodoRow onAdd={onAdd} dealId={deal.id} compact />
      {open.length === 0 && done.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', padding: '6px 0' }}>
          No tasks yet — add one above
        </div>
      )}
      {open.map((t) => (
        <TodoRow key={t.id} todo={t} deals={[deal]} onPatch={onPatch} onDelete={onDelete} compact />
      ))}
      {done.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer', userSelect: 'none', listStyle: 'none', padding: '4px 0' }}>
            {done.length} completed
          </summary>
          {done.map((t) => (
            <TodoRow key={t.id} todo={t} deals={[deal]} onPatch={onPatch} onDelete={onDelete} compact />
          ))}
        </details>
      )}
      {mine.length > 0 && onViewAll && (
        <button onClick={onViewAll}
          style={{ border: 'none', background: 'none', color: 'var(--accent)', fontSize: 12,
            cursor: 'pointer', padding: '6px 0 0', fontWeight: 500 }}>
          View all tasks →
        </button>
      )}
    </div>
  );
}

/* ── full-page TasksView ── */
function TodoView({ todos, deals, onAdd, onPatch, onDelete, onOpenDeal }) {
  const [filter, setFilter] = useST('all'); // all | deal | general | done
  const [dealFilter, setDealFilter] = useST('');

  const open   = todos.filter((t) => !t.done);
  const done   = todos.filter((t) => t.done);
  const high   = open.filter((t) => t.priority === 'high');
  const overdue = open.filter((t) => t.dueDate && t.dueDate < todayStr());

  const displayed = (() => {
    let list = filter === 'done' ? done : open;
    if (filter === 'deal')    list = list.filter((t) => !!t.dealId);
    if (filter === 'general') list = list.filter((t) => !t.dealId);
    if (dealFilter)           list = list.filter((t) => t.dealId === dealFilter);
    // sort: high first, then by dueDate, then createdAt
    return [...list].sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  })();

  const filterBtn = (key, label, count) => {
    const on = filter === key;
    return (
      <button key={key} onClick={() => setFilter(key)} style={{
        border: 'none', background: on ? 'var(--accent)' : 'var(--panel)',
        color: on ? '#fff' : 'var(--slate)', borderRadius: 999,
        padding: '5px 14px', fontSize: 12.5, fontWeight: on ? 600 : 400,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {label}
        {count != null && count > 0 && (
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 999,
            background: on ? 'rgba(255,255,255,.25)' : 'rgba(12,122,67,.12)',
            color: on ? '#fff' : 'var(--accent)', fontWeight: 600 }}>{count}</span>
        )}
      </button>
    );
  };

  const dealsWithTasks = deals.filter((d) => todos.some((t) => t.dealId === d.id));

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 28px 80px' }}>
      {/* header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontWeight: 600, fontSize: 25, color: 'var(--ink)', letterSpacing: '-.01em' }}>Tasks</h2>
        <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--muted)' }}>
          {open.length} open · {done.length} completed
          {high.length > 0 && <> · <span style={{ color: 'var(--neg)', fontWeight: 600 }}>{high.length} high priority</span></>}
          {overdue.length > 0 && <> · <span style={{ color: 'var(--neg)', fontWeight: 600 }}>{overdue.length} overdue</span></>}
        </p>
      </div>

      {/* filters */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {filterBtn('all',     'All open',   open.length)}
        {filterBtn('deal',    'Deal tasks', open.filter((t) => !!t.dealId).length)}
        {filterBtn('general', 'General',    open.filter((t) => !t.dealId).length)}
        {filterBtn('done',    'Completed',  done.length)}
        {dealsWithTasks.length > 1 && (
          <select value={dealFilter} onChange={(e) => setDealFilter(e.target.value)}
            style={{ border: '1px solid var(--line-2)', borderRadius: 999, padding: '5px 12px',
              background: 'var(--panel)', fontSize: 12.5, color: 'var(--ink)', marginLeft: 4 }}>
            <option value="">All deals</option>
            {dealsWithTasks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
      </div>

      {/* add row */}
      {filter !== 'done' && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)',
          borderRadius: 10, padding: '14px 16px', marginBottom: 16,
          boxShadow: 'var(--shadow)' }}>
          <AddTodoRow onAdd={onAdd} deals={deals} placeholder="Add a task… (Enter to save)" />
        </div>
      )}

      {/* list */}
      {displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '56px 0', color: 'var(--muted)' }}>
          <Icon name="check" size={36} style={{ display: 'block', margin: '0 auto 12px', opacity: .3 }} />
          <div style={{ fontSize: 15, fontWeight: 500 }}>
            {filter === 'done' ? 'No completed tasks yet' : 'All clear — no tasks here'}
          </div>
        </div>
      ) : (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--line)',
          borderRadius: 10, padding: '4px 16px', boxShadow: 'var(--shadow)' }}>
          {displayed.map((t) => (
            <TodoRow key={t.id} todo={t} deals={deals} onPatch={onPatch} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Pipeline table cell: a deal's open tasks plus a quick add. Checking one off completes it
   (it moves to Completed on the Tasks tab and leaves the pipeline). Tasks carry the deal's id,
   so they also show on the deal page and the Tasks tab. ── */
function PipelineTaskCell({ dealId, todos, onAdd, onPatch }) {
  const [adding, setAdding] = useST(false);
  const [text, setText] = useST('');
  const open = (todos || []).filter((t) => t.dealId === dealId && !t.done)
    .sort((a, b) => (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0) || String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')));
  const save = () => {
    const t = text.trim();
    if (t) onAdd({ id: 'todo-' + Date.now(), text: t, done: false, dealId, priority: 'normal', dueDate: null, createdAt: todayStr(), completedAt: null });
    setText(''); setAdding(false);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      {open.slice(0, 2).map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <button type="button" title="Mark done" aria-label={'Mark done: ' + t.text}
            onClick={() => onPatch(t.id, { done: true, completedAt: todayStr() })}
            style={{ flex: 'none', width: 15, height: 15, borderRadius: 4, border: '1.5px solid ' + (t.priority === 'high' ? 'var(--neg)' : 'var(--line-2)'),
              background: 'transparent', cursor: 'pointer', padding: 0 }} />
          <span className="clip" title={t.text} style={{ fontSize: 12, color: 'var(--ink)' }}>{t.text}</span>
        </div>))}
      {open.length > 2 && <span style={{ fontSize: 11, color: 'var(--muted)', paddingLeft: 21 }}>+{open.length - 2} more</span>}
      {adding
        ? <input autoFocus value={text} placeholder="New task, Enter to save" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setText(''); setAdding(false); } }} onBlur={save}
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--accent)', borderRadius: 6, padding: '4px 7px', fontSize: 12, outline: 'none',
              boxShadow: '0 0 0 3px var(--accent-soft)', fontFamily: 'var(--font)', color: 'var(--ink)', background: 'var(--panel)' }} />
        : <button type="button" onClick={() => setAdding(true)}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px dashed var(--line-2)', borderRadius: 6, background: 'transparent',
              color: 'var(--muted)', fontSize: 11.5, fontWeight: 600, padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font)' }}>
            <Icon name="plus" size={11} />Add task</button>}
    </div>);
}

Object.assign(window, { TodoView, DealTodos, PipelineTaskCell });
