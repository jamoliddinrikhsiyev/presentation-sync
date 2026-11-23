const slots = [0, 1, 2];
let state = { presentations: [], displays: [], assignments: [] };
const draft = slots.map(() => ({ presentationId: '', displayId: '' }));

const assignments = document.querySelector('#assignments');
const status = document.querySelector('#status');
const toast = document.querySelector('#toast');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

function options(items, value, label) {
  return [`<option value="">${label}</option>`, ...items.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === value ? 'selected' : ''}>${escapeHtml(item.label)}</option>`)].join('');
}

function render() {
  assignments.innerHTML = slots
    .map((slot) => {
      const item = draft[slot];
      const documents = state.presentations.map((presentation) => ({ id: presentation.id, label: presentation.name }));
      const displays = state.displays.map((display) => ({ id: display.id, label: `${display.label} · ${display.size}${display.primary ? ' · основной' : ''}` }));
      return `<article class="assignment">
        <div class="slot">${slot + 1}</div>
        <div class="selects">
          <label>Презентация<select data-slot="${slot}" data-kind="presentation">${options(documents, item.presentationId, 'Выбрать файл')}</select></label>
          <label>Экран<select data-slot="${slot}" data-kind="display">${options(displays, item.displayId, 'Выбрать дисплей')}</select></label>
        </div>
        <button class="file" data-pick="${slot}">Выбрать файл</button>
      </article>`;
    })
    .join('');
  const active = state.assignments.length;
  status.textContent = active ? `Идёт показ: ${active} ${active === 1 ? 'экран' : 'экрана'}` : `Доступно экранов: ${state.displays.length}`;
}

function showError(error) {
  toast.textContent = error?.message || String(error);
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 5000);
}

async function load() {
  state = await window.presentationSync.getControllerState();
  render();
}

assignments.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  draft[Number(target.dataset.slot)][`${target.dataset.kind}Id`] = target.value;
});

assignments.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || target.dataset.pick === undefined) return;
  try {
    const presentation = await window.presentationSync.choosePresentation();
    if (presentation) {
      draft[Number(target.dataset.pick)].presentationId = presentation.id;
      await load();
    }
  } catch (error) {
    showError(error);
  }
});

document.querySelector('#refresh').addEventListener('click', load);
document.querySelector('#start').addEventListener('click', async () => {
  const selected = draft.filter((item) => item.presentationId || item.displayId);
  if (selected.some((item) => !item.presentationId || !item.displayId)) return showError(new Error('В каждой заполненной строке выберите и файл, и экран.'));
  try {
    await window.presentationSync.start(selected);
  } catch (error) {
    showError(error);
  }
});
document.querySelector('#stop').addEventListener('click', () => window.presentationSync.stop());
document.querySelector('.remote').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-command]');
  if (button) window.presentationSync.command(button.dataset.command);
});

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLSelectElement) return;
  const command = event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown' ? 'next' : event.key === 'ArrowLeft' || event.key === 'PageUp' || event.key === 'Backspace' ? 'previous' : event.key === 'Home' ? 'first' : null;
  if (!command) return;
  event.preventDefault();
  window.presentationSync.command(command);
});

window.presentationSync.onControllerState((nextState) => {
  state = nextState;
  render();
});
load().catch(showError);
