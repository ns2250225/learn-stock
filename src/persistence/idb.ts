// 轻量 IndexedDB 键值存储：存档、快照与档案；LocalStorage 仅存放轻量设置
const DB_NAME = 'pixel-stock-city'
const STORE = 'kv'
let dbp: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode)
        const r = fn(t.objectStore(STORE))
        r.onsuccess = () => resolve(r.result as T)
        r.onerror = () => reject(r.error)
      }),
  )
}

export const idb = {
  get<T>(key: string): Promise<T | undefined> {
    return tx<T | undefined>('readonly', (s) => s.get(key))
  },
  set(key: string, val: unknown): Promise<void> {
    return tx<void>('readwrite', (s) => s.put(val, key))
  },
  del(key: string): Promise<void> {
    return tx<void>('readwrite', (s) => s.delete(key))
  },
  keys(): Promise<string[]> {
    return tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((k) => k.map(String))
  },
  clear(): Promise<void> {
    return tx<void>('readwrite', (s) => s.clear())
  },
}
