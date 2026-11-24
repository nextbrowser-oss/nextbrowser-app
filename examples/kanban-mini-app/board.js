const stages = ['To do', 'In progress', 'Done'];
const byId = id => document.getElementById(id);
const board = byId('columns'), editor = byId('editor'), add = byId('add');
let cards = [], revision = 0, editing = null, busy = true;
const element = (tag, text) => Object.assign(document.createElement(tag), { textContent: text });
function button(text, click) {
  const node = element('button', text);
  node.type = 'button';
  node.onclick = click;
  return node;
}
function openEditor(card) {
  editing = card?.id ?? null;
  byId('editor-title').textContent = card ? 'Edit task' : 'New task';
  byId('task-title').value = card?.title ?? '';
  byId('notes').value = card?.notes ?? '';
  byId('stage').value = card?.stage ?? stages[0];
  editor.showModal();
  byId('task-title').focus();
}
function render() {
  board.replaceChildren();
  add.disabled = busy;
  board.inert = busy;
  byId('counts').textContent = cards.length + (cards.length === 1 ? ' task' : ' tasks');
  for (const stage of stages) {
    const lane = element('section', ''), heading = element('div', '');
    const subset = cards.filter(card => card.stage === stage);
    lane.className = 'lane';
    heading.className = 'lane-heading';
    heading.append(element('h2', stage), element('span', String(subset.length)));
    lane.append(heading);
    lane.ondragover = event => event.preventDefault();
    lane.ondrop = event => {
      event.preventDefault();
      const id = event.dataTransfer.getData('text/plain');
      if (cards.some(c => c.id === id && c.stage !== stage)) void uiAction('move_task', { id, stage });
    };
    for (const card of subset) {
      const article = element('article', ''), actions = element('div', '');
      article.className = 'card';
      article.draggable = true;
      article.ondragstart = event => event.dataTransfer.setData('text/plain', card.id);
      article.append(element('strong', card.title));
      if (card.notes) article.append(element('p', card.notes));
      actions.className = 'actions';
      actions.append(button('Edit', () => openEditor(card)));
      if (stage !== 'Done') {
        const next = stages[stages.indexOf(stage) + 1];
        actions.append(button('Move to ' + next, () => uiAction('move_task', { id: card.id, stage: next })));
      }
      const remove = button('Delete', () => {
        const expected = revision;
        actions.replaceChildren(button('Confirm delete', () => uiAction('delete_task', { id: card.id, confirm: true, revision: expected })), button('Cancel', render));
      });
      actions.append(remove);
      article.append(actions);
      lane.append(article);
    }
    if (!subset.length) lane.append(Object.assign(element('p', 'No tasks'), { className: 'empty' }));
    board.append(lane);
  }
}
async function load() {
  const response = await fetch('/state');
  if (!response.ok) throw Error('Could not load the board. Reopen Kanban to retry.');
  const snapshot = await response.json();
  cards = snapshot.value?.cards ?? [];
  revision = snapshot.revision;
}
async function save(next) {
  if (busy) throw Error('Board is busy. Read the board before retrying.');
  busy = true;
  render();
  try {
    const response = await fetch('/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision, value: { cards: next } }) });
    if (response.status === 409) {
      await load();
      editor.close();
      throw Error('The board changed in another window. Review the latest tasks and try again.');
    }
    if (!response.ok) throw Error('Could not save the board. Check the storage limit and try again.');
    revision = (await response.json()).revision;
    cards = next;
    byId('notice').textContent = '';
    return true;
  } finally { busy = false; render(); }
}
const id = { type: 'string', description: 'Task ID returned by list_tasks.' };
const title = { type: 'string', minLength: 1, maxLength: 160 };
const notes = { type: 'string', maxLength: 2000 };
const stage = { type: 'string', enum: stages };
const version = { type: 'integer', minimum: 0, description: 'Board revision returned by a read.' };
function task(id) {
  const card = cards.find(card => card.id === id);
  if (!card) throw Error('Task not found. Read the board again.');
  return card;
}
async function edit({ id, ...changes }) {
  if (!Object.keys(changes).length) throw Error('Supply a title, notes or column.');
  const previous = task(id);
  const card = { ...previous, ...changes };
  await save(cards.map(item => item.id === id ? card : item));
  return { revision, card };
}
function tool(description, properties, required, run) {
  return { description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, run };
}
const operations = {
  list_tasks: tool('Read columns, task IDs, titles and the current board revision. Page with next_offset.', {
    offset: { type: 'integer', minimum: 0 }, stage,
  }, [], ({ offset = 0, stage }) => {
    const rows = cards.filter(card => !stage || card.stage === stage);
    const page = rows.slice(offset, offset + 20).map(({ id, title, stage }) => ({ id, title, stage }));
    return { revision, columns: stages, total: rows.length, tasks: page, next_offset: offset + page.length < rows.length ? offset + page.length : null };
  }),
  get_task: tool('Read one task including its notes and the board revision.', { id }, ['id'], ({ id }) => ({ revision, card: task(id) })),
  create_task: tool('Create a task. The default column is To do.', { title, notes, stage }, ['title'], async input => {
    const card = { id: crypto.randomUUID(), notes: '', stage: stages[0], ...input };
    await save([...cards, card]);
    return { revision, card };
  }),
  edit_task: tool('Update one or more fields of an existing task.', { id, title, notes, stage }, ['id'], edit),
  move_task: tool('Move a task to any board column.', { id, stage }, ['id', 'stage'], edit),
  delete_task: tool('Delete only the explicitly requested task, after checking its ID and board revision.', {
    id, revision: version, confirm: { type: 'boolean', description: 'True when the user requested deletion.' },
  }, ['id', 'revision', 'confirm'], async input => {
    task(input.id);
    if (input.confirm !== true || input.revision !== revision) throw Error('Check the current task and revision before confirming deletion.');
    await save(cards.filter(card => card.id !== input.id));
    return { revision, deleted: input.id };
  }),
};
async function act(name, input) {
  const { inputSchema, run } = operations[name];
  if (busy) throw Error('Board is loading or saving. Try again after it is ready.');
  if (!input || typeof input !== 'object' || Array.isArray(input) || inputSchema.required.some(key => !Object.hasOwn(input, key))) throw Error('Missing task arguments.');
  const clean = {};
  for (const [key, value] of Object.entries(input)) {
    const schema = Object.hasOwn(inputSchema.properties, key) && inputSchema.properties[key];
    if (!schema || (schema.type === 'integer' ? !Number.isSafeInteger(value) || value < 0 : typeof value !== schema.type)
      || (schema.enum && !schema.enum.includes(value)) || (schema.maxLength && value.length > schema.maxLength)) throw Error('Invalid task field: ' + key);
    clean[key] = typeof value === 'string' ? value.trim() : value;
    if (key === 'title' && !clean[key]) throw Error('A task title is required.');
  }
  return run(clean);
}
async function uiAction(name, input) {
  try { await act(name, input); return true; }
  catch (error) { byId('notice').textContent = error.message; return false; }
}
byId('stage').append(...stages.map(stage => element('option', stage)));
add.onclick = () => openEditor(null);
byId('cancel').onclick = () => editor.close();
byId('task-form').onsubmit = async event => {
  event.preventDefault();
  const title = byId('task-title').value.trim();
  if (!title) { byId('task-title').focus(); return; }
  const fields = { title, notes: byId('notes').value, stage: byId('stage').value };
  if (await uiAction(editing ? 'edit_task' : 'create_task', editing ? { id: editing, ...fields } : fields)) editor.close();
};
try {
  await load();
  for (const [name, { description, inputSchema }] of Object.entries(operations)) {
    await document.modelContext.registerTool({ name, description, inputSchema, execute: async input => {
      try {
        if (editor.open && name !== 'list_tasks' && name !== 'get_task') throw Error('Finish or cancel the open edit before changing the board.');
        return { ok: true, value: await act(name, input) };
      } catch (error) { return { ok: false, error: error.message }; }
    } });
  }
  busy = false; render();
}
catch (error) { byId('notice').textContent = error.message; }
