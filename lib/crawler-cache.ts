// 크롤러 페이지 영구 캐시(IndexedDB) — 페이지 재진입/F5/새 탭에도 즉시 렌더.
//   각 크롤러(meta/google/owned)의 전체 경량 행을 한 덩어리로 저장/복원한다.
//   용량 제한이 큰 IndexedDB 라 구글 3만+ 행도 문제없음(localStorage 는 5MB 라 불가).

const DB_NAME = 'crawler-cache'
const DB_VER = 1
const STORES = ['meta', 'google', 'owned'] as const
export type CacheStore = (typeof STORES)[number]

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'))
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// 저장된 전체 행 배열(없으면 null). 실패해도 앱은 정상 동작(그냥 서버에서 로드).
export async function loadCache<T>(store: CacheStore): Promise<T[] | null> {
  try {
    const db = await openDB()
    return await new Promise<T[] | null>((resolve) => {
      const tx = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).get('rows')
      req.onsuccess = () => resolve((req.result as T[]) || null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

// 전체 행 배열 저장(디바운스는 호출측에서). 실패는 조용히 무시.
export async function saveCache<T>(store: CacheStore, rows: T[]): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(rows, 'rows')
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    /* 무시 */
  }
}
