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
      if (cards.some(c => c.id === id && c.stage !== stage)) void save(cards.map(c => c.id === id ? { ...c, stage } : c));
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
        actions.append(button('Move to ' + next, () => save(cards.map(c => c.id === card.id ? { ...c, stage: next } : c))));
      }
      const remove = button('Delete', () => {
        actions.replaceChildren(button('Confirm delete', () => save(cards.filter(c => c.id !== card.id))), button('Cancel', render));
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
  if (busy) return false;
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
  } catch (error) { byId('notice').textContent = error.message; return false; }
  finally { busy = false; render(); }
}
byId('stage').append(...stages.map(stage => element('option', stage)));
add.onclick = () => openEditor(null);
byId('cancel').onclick = () => editor.close();
byId('task-form').onsubmit = async event => {
  event.preventDefault();
  const title = byId('task-title').value.trim();
  if (!title) { byId('task-title').focus(); return; }
  const card = { id: editing ?? crypto.randomUUID(), title, notes: byId('notes').value.trim(), stage: byId('stage').value };
  if (await save(editing ? cards.map(c => c.id === editing ? card : c) : [...cards, card])) editor.close();
};
try { await load(); busy = false; render(); }
catch (error) { byId('notice').textContent = error.message; }
