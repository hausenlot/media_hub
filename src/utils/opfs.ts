export async function getOPFSDirectory(path: string) {
  const root = await navigator.storage.getDirectory();
  const parts = path.split('/').filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

export async function saveToOPFS(path: string, fileName: string, blob: Blob) {
  const dir = await getOPFSDirectory(path);
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

export async function getFromOPFS(path: string, fileName: string): Promise<Blob | null> {
  try {
    const dir = await getOPFSDirectory(path);
    const fileHandle = await dir.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    // 404 pages are usually small HTML; models are many MBs. 1KB is a safe floor.
    if (file.size <= 1024) return null;
    return file;
  } catch (e) {
    return null;
  }
}

export async function existsInOPFS(path: string, fileName: string): Promise<boolean> {
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
