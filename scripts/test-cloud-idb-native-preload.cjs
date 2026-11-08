const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('syntheticCloudBridge', payload => ipcRenderer.invoke('synthetic-cloud-test', payload));
