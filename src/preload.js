const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('presentationSync', {
  getControllerState: () => ipcRenderer.invoke('controller:state'),
  choosePresentation: () => ipcRenderer.invoke('presentation:choose'),
  start: (assignments) => ipcRenderer.invoke('projection:start', assignments),
  stop: () => ipcRenderer.invoke('projection:stop'),
  command: (command) => ipcRenderer.invoke('projection:command', command),
  getDisplayState: (displayId) => ipcRenderer.invoke('display:state', displayId),
  displayReady: (displayId, pageCount) => ipcRenderer.send('display:ready', displayId, pageCount),
  onControllerState: (callback) => ipcRenderer.on('controller:state', (_event, state) => callback(state)),
  onDisplayState: (callback) => ipcRenderer.on('display:state', (_event, state) => callback(state)),
});
