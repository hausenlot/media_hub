// Simple OPFS helper for the worker
async function getOPFSDirectory(path) {
  const root = await navigator.storage.getDirectory();
  const parts = path.split('/').filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

async function saveToOPFS(path, fileName, blob) {
  const dir = await getOPFSDirectory(path);
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  
  let accessHandle;
  try {
    // Attempt createSyncAccessHandle first (best for OPFS in workers)
    accessHandle = await fileHandle.createSyncAccessHandle();
    const buffer = await blob.arrayBuffer();
    accessHandle.write(buffer);
    accessHandle.flush();
  } catch (e) {
    // Fallback to createWritable if available
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (e2) {
      console.error('Failed to write to OPFS:', e, e2);
      throw e;
    }
  } finally {
    if (accessHandle) {
      accessHandle.close();
    }
  }
}

async function existsInOPFS(path, fileName) {
  try {
    const dir = await getOPFSDirectory(path);
    const fileHandle = await dir.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    // 404 pages are usually small HTML; models are many MBs. 1KB is a safe floor.
    return file.size > 1024;
  } catch (e) {
    return false;
  }
}

self.onmessage = async (event) => {
  const { voicesToPreload, baseUrl } = event.data;

  // Process voices one by one to keep it "non-intrusive"
  for (const voice of voicesToPreload) {
    const { key, files } = voice;
    const opfsPath = `models/${key}`;

    try {
      const isCached = await existsInOPFS(opfsPath, 'model.onnx') && await existsInOPFS(opfsPath, 'model.json');
      
      if (!isCached) {
        self.postMessage({ kind: 'status', key, status: 'downloading' });
        
        const modelPath = Object.keys(files).find(f => f.endsWith('.onnx'));
        const configPath = Object.keys(files).find(f => f.endsWith('.json'));
        
        const [mRes, cRes] = await Promise.all([
          fetch(`${baseUrl}${modelPath}`),
          fetch(`${baseUrl}${configPath}`)
        ]);

        if (!mRes.ok || !cRes.ok) {
          throw new Error(`Failed to download model or config: ${mRes.status} ${cRes.status}`);
        }

        const [mBlob, cBlob] = await Promise.all([mRes.blob(), cRes.blob()]);

        await saveToOPFS(opfsPath, 'model.onnx', mBlob);
        await saveToOPFS(opfsPath, 'model.json', cBlob);

        self.postMessage({ kind: 'status', key, status: 'cached' });
        
        // Brief pause between preloads to be non-intrusive
        await new Promise(r => setTimeout(r, 2000));
      } else {
        self.postMessage({ kind: 'status', key, status: 'cached' });
      }
    } catch (err) {
      console.error(`Preload failed for ${key}:`, err);
      self.postMessage({ kind: 'status', key, status: 'error' });
    }
  }

  self.postMessage({ kind: 'complete' });
};
