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

// 저장된 캐시(없으면 null). complete=true 일 때만 "전체를 담았다"는 의미 → 델타 동기화 허용.
//   부분(로드 중 끊김)·구버전(배열) 캐시는 complete=false 로 취급해 호출측이 전체 재로드하게 한다.
export async function loadCache<T>(store: CacheStore): Promise<{ rows: T[]; complete: boolean } | null> {
  try {
    const db = await openDB()
    return await new Promise<{ rows: T[]; complete: boolean } | null>((resolve) => {
      const tx = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).get('rows')
      req.onsuccess = () => {
        const val = req.result
        if (!val) return resolve(null)
        if (Array.isArray(val)) return resolve({ rows: val as T[], complete: false }) // 구버전(배열) → 미완료 취급
        if (val && Array.isArray(val.rows)) return resolve({ rows: val.rows as T[], complete: !!val.complete })
        resolve(null)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

// 전체 행 저장. complete=true 는 "이 시점 전체 데이터를 담았음" 표시(다음 진입 시 델타만).
export async function saveCache<T>(store: CacheStore, rows: T[], complete: boolean): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put({ rows, complete }, 'rows')
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    /* 무시 */
  }
}
