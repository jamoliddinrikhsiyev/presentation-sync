import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs';

const displayId = new URLSearchParams(location.search).get('displayId');
const canvas = document.querySelector('#slide');
const empty = document.querySelector('#empty');
const counter = document.querySelector('#counter');
let pdf = null;
let currentPresentationId = null;
let currentPage = 0;

function bytesFromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function render(page) {
  if (!pdf) return;
  const pdfPage = await pdf.getPage(page + 1);
  const base = pdfPage.getViewport({ scale: 1 });
  const scale = Math.min(window.innerWidth / base.width, window.innerHeight / base.height) * Math.min(window.devicePixelRatio, 2);
  const viewport = pdfPage.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / Math.min(window.devicePixelRatio, 2))}px`;
  canvas.style.height = `${Math.floor(viewport.height / Math.min(window.devicePixelRatio, 2))}px`;
  await pdfPage.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
}

async function apply(state) {
  if (!state.active) {
    empty.textContent = 'Показ остановлен';
    empty.hidden = false;
    canvas.hidden = true;
    return;
  }
  if (state.presentationId !== currentPresentationId) {
    // `display:state` после запуска содержит только номер слайда, чтобы не
    // пересылать многомегабайтный PDF при каждом клике. Если этот сигнал
    // пришёл раньше первого ответа `getDisplayState`, забираем полный снимок.
    if (!state.pdf) state = await window.presentationSync.getDisplayState(displayId);
    empty.textContent = 'Открываю презентацию…';
    empty.hidden = false;
    canvas.hidden = true;
    currentPresentationId = state.presentationId;
    pdf = await pdfjsLib.getDocument({ data: bytesFromBase64(state.pdf) }).promise;
    window.presentationSync.displayReady(displayId, pdf.numPages);
  }
  currentPage = Math.max(0, Math.min(state.page, pdf.numPages - 1));
  await render(currentPage);
  empty.hidden = true;
  canvas.hidden = false;
  counter.textContent = `${currentPage + 1} / ${pdf.numPages}`;
}

window.addEventListener('resize', () => render(currentPage));
window.presentationSync.onDisplayState((state) => apply(state).catch((error) => { empty.textContent = error.message; empty.hidden = false; }));
window.presentationSync.getDisplayState(displayId).then(apply).catch((error) => { empty.textContent = error.message; });
