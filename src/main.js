const { app, BrowserWindow, dialog, ipcMain, screen } = require('electron');
const { randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** @type {BrowserWindow | null} */
let controller = null;
/** @type {Map<string, BrowserWindow>} */
const projectionWindows = new Map();
/** @type {Map<string, {id: string, name: string, pdfPath: string, pageCount: number | null}>} */
const presentations = new Map();
/** @type {Map<string, {displayId: string, presentationId: string, page: number}>} */
const assignments = new Map();

const sourcePath = (...parts) => path.join(__dirname, ...parts);

function safeWindowOptions() {
  return {
    preload: sourcePath('preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

function visibleDisplays() {
  return screen.getAllDisplays().map((display) => ({
    id: String(display.id),
    label: display.label || `Дисплей ${display.id}`,
    size: `${display.size.width} × ${display.size.height}`,
    primary: display.id === screen.getPrimaryDisplay().id,
  }));
}

function publicState() {
  return {
    presentations: [...presentations.values()].map(({ id, name, pageCount }) => ({ id, name, pageCount })),
    displays: visibleDisplays(),
    assignments: [...assignments.values()].map((assignment) => ({
      ...assignment,
      presentation: presentations.get(assignment.presentationId)?.name ?? 'Не найдена',
      pageCount: presentations.get(assignment.presentationId)?.pageCount ?? null,
    })),
  };
}

function broadcastController() {
  if (controller && !controller.isDestroyed()) controller.webContents.send('controller:state', publicState());
}

function displayPayload(displayId) {
  const assignment = assignments.get(String(displayId));
  if (!assignment) return { active: false };
  const presentation = presentations.get(assignment.presentationId);
  if (!presentation) return { active: false };
  return {
    active: true,
    displayId: String(displayId),
    presentationId: presentation.id,
    title: presentation.name,
    page: assignment.page,
    pageCount: presentation.pageCount,
    pdf: null,
  };
}

async function displayPayloadWithPdf(displayId) {
  const payload = displayPayload(displayId);
  if (!payload.active) return payload;
  const presentation = presentations.get(payload.presentationId);
  return { ...payload, pdf: (await fs.readFile(presentation.pdfPath)).toString('base64') };
}

function broadcastProjections() {
  for (const [displayId, window] of projectionWindows) {
    if (!window.isDestroyed()) window.webContents.send('display:state', displayPayload(displayId));
  }
  broadcastController();
}

function findLibreOffice() {
  const candidates = [
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/Applications/OpenOffice.app/Contents/MacOS/soffice',
    '/usr/local/bin/soffice',
    '/opt/homebrew/bin/soffice',
    'soffice',
  ];
  return candidates.find((candidate) => candidate === 'soffice' || existsSync(candidate)) ?? null;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Конвертация завершилась с кодом ${code}.`))));
  });
}

async function presentationPdf(filePath) {
  if (path.extname(filePath).toLowerCase() === '.pdf') return filePath;
  const soffice = findLibreOffice();
  if (!soffice) throw new Error('Для открытия .pptx установите LibreOffice или экспортируйте презентацию в PDF.');
  const directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'presentation-sync-'));
  await run(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', directory, filePath]);
  const pdfPath = path.join(directory, `${path.basename(filePath, path.extname(filePath))}.pdf`);
  if (!existsSync(pdfPath)) throw new Error('LibreOffice не создал PDF-файл.');
  return pdfPath;
}

async function choosePresentation() {
  const result = await dialog.showOpenDialog(controller, {
    title: 'Выберите презентацию',
    properties: ['openFile'],
    filters: [
      { name: 'Презентации и PDF', extensions: ['pptx', 'ppt', 'pdf'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];
  const pdfPath = await presentationPdf(filePath);
  const presentation = { id: randomUUID(), name: path.basename(filePath), pdfPath, pageCount: null };
  presentations.set(presentation.id, presentation);
  broadcastController();
  return { id: presentation.id, name: presentation.name, pageCount: null };
}

function closeProjectionWindows() {
  for (const window of projectionWindows.values()) window.close();
  projectionWindows.clear();
}

async function startProjection(nextAssignments) {
  if (!Array.isArray(nextAssignments) || nextAssignments.length < 1 || nextAssignments.length > 3) {
    throw new Error('Выберите от одной до трёх презентаций.');
  }
  const displayIds = new Set();
  for (const item of nextAssignments) {
    if (!presentations.has(item.presentationId)) throw new Error('Одна из презентаций больше недоступна.');
    if (displayIds.has(String(item.displayId))) throw new Error('Каждая презентация должна быть назначена на отдельный дисплей.');
    displayIds.add(String(item.displayId));
  }
  const displays = new Map(screen.getAllDisplays().map((display) => [String(display.id), display]));
  if ([...displayIds].some((id) => !displays.has(id))) throw new Error('Один из дисплеев был отключён. Обновите список.');

  closeProjectionWindows();
  assignments.clear();
  for (const item of nextAssignments) assignments.set(String(item.displayId), { ...item, displayId: String(item.displayId), page: 0 });

  for (const item of assignments.values()) {
    const display = displays.get(item.displayId);
    const window = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      fullscreen: true,
      backgroundColor: '#05070c',
      webPreferences: safeWindowOptions(),
    });
    projectionWindows.set(item.displayId, window);
    window.on('closed', () => {
      projectionWindows.delete(item.displayId);
      broadcastController();
    });
    await window.loadFile(sourcePath('display.html'), { query: { displayId: item.displayId } });
  }
  controller?.focus();
  broadcastController();
}

function commandProjection(command) {
  for (const assignment of assignments.values()) {
    const presentation = presentations.get(assignment.presentationId);
    if (!presentation?.pageCount) continue;
    if (command === 'next') assignment.page = Math.min(presentation.pageCount - 1, assignment.page + 1);
    if (command === 'previous') assignment.page = Math.max(0, assignment.page - 1);
    if (command === 'first') assignment.page = 0;
  }
  broadcastProjections();
}

function createController() {
  controller = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    title: 'Presentation Sync',
    backgroundColor: '#0b1020',
    webPreferences: safeWindowOptions(),
  });
  controller.loadFile(sourcePath('controller.html'));
  controller.on('closed', () => {
    controller = null;
    closeProjectionWindows();
  });
}

app.whenReady().then(() => {
  createController();
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, broadcastController);
  app.on('activate', () => {
    if (!controller) createController();
  });
});

app.on('window-all-closed', () => app.quit());

ipcMain.handle('controller:state', () => publicState());
ipcMain.handle('presentation:choose', choosePresentation);
ipcMain.handle('projection:start', (_event, value) => startProjection(value));
ipcMain.handle('projection:stop', () => {
  closeProjectionWindows();
  assignments.clear();
  broadcastController();
});
ipcMain.handle('projection:command', (_event, command) => commandProjection(command));
ipcMain.handle('display:state', (_event, displayId) => displayPayloadWithPdf(displayId));
ipcMain.on('display:ready', (_event, displayId, pageCount) => {
  const assignment = assignments.get(String(displayId));
  if (!assignment || !Number.isInteger(pageCount) || pageCount < 1) return;
  const presentation = presentations.get(assignment.presentationId);
  if (!presentation) return;
  presentation.pageCount = pageCount;
  assignment.page = Math.min(assignment.page, pageCount - 1);
  broadcastProjections();
});
