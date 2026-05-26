/**
 * Firestore 기반 노트 저장소
 * 컬렉션: users/{uid}/notes/{noteId}
 */
import { getCurrentUser } from "./auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

/** @typedef {'youtube'|'article'|'podcast'|'book'|'other'} MediaType */
/** @typedef {'to_watch'|'watched'} WatchStatus */

/**
 * @typedef {Object} ContentEntry
 * @property {string} id
 * @property {MediaType} type
 * @property {string} url
 * @property {string} title
 * @property {string} [publishedAt]
 * @property {string} [thumbnail]
 * @property {string} summary
 * @property {string[]} keywords
 * @property {string[]} categories
 * @property {WatchStatus} status
 * @property {string} [watchedAt]
 * @property {string} createdAt
 * @property {string} updatedAt
 */

let _db = null;

export function initFirestore(firebaseApp) {
  _db = getFirestore(firebaseApp);
  return _db;
}

function notesCollection() {
  const user = getCurrentUser();
  if (!user || !_db) return null;
  return collection(_db, "users", user.uid, "notes");
}

export const DEFAULT_CATEGORIES = [
  "투자", "기업", "인물", "경제", "기술", "경영", "역사", "기타",
];

export const MEDIA_LABELS = {
  youtube: "유튜브",
  article: "신문·기사",
  podcast: "팟캐스트",
  book: "도서·문서",
  other: "기타",
};

export const MEDIA_ICONS = {
  youtube: "▶️",
  article: "📰",
  podcast: "🎧",
  book: "📖",
  other: "📎",
};

export function isMobileLayout() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(max-width: 768px)").matches ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

/** @returns {Promise<ContentEntry[]>} */
export async function loadEntries() {
  const col = notesCollection();
  if (!col) return [];
  const snap = await getDocs(col);
  return snap.docs.map((d) => /** @type {ContentEntry} */ (d.data()));
}

/** @param {ContentEntry} entry */
export async function saveEntry(entry) {
  const col = notesCollection();
  if (!col) throw new Error("로그인이 필요합니다.");
  const ref = doc(col, entry.id);
  await setDoc(ref, entry);
}

/** @param {ContentEntry[]} entries */
export async function saveEntries(entries) {
  const user = getCurrentUser();
  if (!user || !_db) throw new Error("로그인이 필요합니다.");

  const BATCH_LIMIT = 450;
  for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
    const batch = writeBatch(_db);
    const slice = entries.slice(i, i + BATCH_LIMIT);
    for (const entry of slice) {
      const ref = doc(_db, "users", user.uid, "notes", entry.id);
      batch.set(ref, entry);
    }
    await batch.commit();
  }
}

/** @param {string} id */
export async function deleteEntry(id) {
  const col = notesCollection();
  if (!col) return;
  const ref = doc(col, id);
  await deleteDoc(ref);
}

/** @param {ContentEntry[]} imported */
export async function importEntries(imported) {
  const current = await loadEntries();
  const merged = mergeEntriesById(current, imported);
  await saveEntries(merged);
  return merged;
}

export function mergeEntriesById(...lists) {
  const map = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && typeof item === "object" && item.id) {
        const prev = map.get(item.id);
        if (!prev) {
          map.set(item.id, item);
        } else {
          const a = item.updatedAt || item.createdAt || "";
          const b = prev.updatedAt || prev.createdAt || "";
          map.set(item.id, a >= b ? item : prev);
        }
      }
    }
  }
  return [...map.values()];
}

export function newId() {
  return (
    crypto.randomUUID?.() ??
    `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  );
}

export function parseTags(csv) {
  return csv
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const statusOrder = { to_watch: 0, watched: 1 };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    const dateA = a.watchedAt || a.updatedAt || a.createdAt;
    const dateB = b.watchedAt || b.updatedAt || b.createdAt;
    return dateB.localeCompare(dateA);
  });
}
