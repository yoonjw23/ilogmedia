/**
 * 단어·선택 영역 번역 (중국어 병음·성조 포함)
 */

import { pinyin } from "https://esm.sh/pinyin-pro@3.26.0";

/** @param {string} text */
export function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

/** @param {string} text */
export function detectSourceLang(text) {
  if (hasChinese(text)) return "zh-CN";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  return "en";
}

/** @param {string} text */
export function toPinyinWithTones(text) {
  if (!hasChinese(text)) return "";
  try {
    return pinyin(text, { toneType: "symbol", type: "array" }).join(" ");
  } catch {
    return "";
  }
}

/** @param {string} text @param {string} [sourceLang] */
export async function translateToKorean(text, sourceLang = "auto") {
  const q = text.trim().slice(0, 500);
  if (!q) return "";

  const sl = sourceLang === "auto" ? detectSourceLang(q) : sourceLang;
  const langpair = `${sl}|ko`;

  try {
    const mm = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(langpair)}`
    );
    if (mm.ok) {
      const data = await mm.json();
      const t = data?.responseData?.translatedText;
      if (t && !/^INVALID|^MYMEMORY WARNING/i.test(t)) return t;
    }
  } catch {
    /* fallback */
  }

  try {
    const gtx = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl === "zh-CN" ? "zh-CN" : sl)}&tl=ko&dt=t&q=${encodeURIComponent(q)}`
    );
    if (gtx.ok) {
      const data = await gtx.json();
      const parts = data?.[0];
      if (Array.isArray(parts)) {
        return parts.map((p) => p?.[0] ?? "").join("");
      }
    }
  } catch {
    /* ignore */
  }

  return "";
}

/**
 * @param {string} text
 * @returns {Promise<{ word: string, pinyin: string, meaning: string, lang: string }>}
 */
export async function lookupWord(text) {
  const word = text.trim().slice(0, 120);
  const lang = detectSourceLang(word);
  const meaning = await translateToKorean(word, lang);
  const py = toPinyinWithTones(word);
  return { word, pinyin: py, meaning, lang };
}

/** @param {string} text */
export function papagoUrl(text) {
  const lang = detectSourceLang(text);
  const sk = lang === "zh-CN" ? "zh-CN" : lang === "ja" ? "ja" : lang === "en" ? "en" : "auto";
  return `https://papago.naver.com/?sk=${sk}&tk=ko&st=${encodeURIComponent(text)}`;
}

/** @param {string} text */
export function googleTranslateUrl(text) {
  return `https://translate.google.com/?sl=auto&tl=ko&text=${encodeURIComponent(text)}&op=translate`;
}

/** @param {string} text */
export function naverDictUrl(text) {
  if (hasChinese(text)) {
    return `https://zh.dict.naver.com/#/search?query=${encodeURIComponent(text)}`;
  }
  return `https://dict.naver.com/dict.search?query=${encodeURIComponent(text)}`;
}

let popoverEl = /** @type {HTMLElement | null} */ (null);
let popoverBusy = false;

function ensurePopover() {
  if (popoverEl) return popoverEl;
  popoverEl = document.createElement("div");
  popoverEl.id = "translate-popover";
  popoverEl.className = "translate-popover";
  popoverEl.hidden = true;
  popoverEl.innerHTML = `
    <button type="button" class="translate-popover__close" aria-label="닫기">×</button>
    <div class="translate-popover__word"></div>
    <div class="translate-popover__pinyin"></div>
    <div class="translate-popover__meaning"></div>
    <div class="translate-popover__links"></div>
  `;
  document.body.appendChild(popoverEl);
  popoverEl.querySelector(".translate-popover__close")?.addEventListener("click", hideTranslatePopover);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTranslatePopover();
  });
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!popoverEl || popoverEl.hidden) return;
      if (e.target instanceof Node && popoverEl.contains(e.target)) return;
      hideTranslatePopover();
    },
    true
  );
  return popoverEl;
}

export function hideTranslatePopover() {
  if (popoverEl) popoverEl.hidden = true;
}

/**
 * @param {string} text
 * @param {number} x
 * @param {number} y
 */
export async function showTranslatePopover(text, x, y) {
  const word = text.trim().replace(/\s+/g, " ");
  if (!word || word.length > 200) return;
  if (popoverBusy) return;

  const el = ensurePopover();
  const wordEl = el.querySelector(".translate-popover__word");
  const pinyinEl = el.querySelector(".translate-popover__pinyin");
  const meaningEl = el.querySelector(".translate-popover__meaning");
  const linksEl = el.querySelector(".translate-popover__links");
  if (!wordEl || !pinyinEl || !meaningEl || !linksEl) return;

  popoverBusy = true;
  wordEl.textContent = word;
  pinyinEl.textContent = hasChinese(word) ? toPinyinWithTones(word) : "";
  pinyinEl.hidden = !pinyinEl.textContent;
  meaningEl.textContent = "번역 중…";
  linksEl.innerHTML = "";

  el.hidden = false;
  positionPopover(el, x, y);

  try {
    const result = await lookupWord(word);
    if (pinyinEl && hasChinese(word)) {
      pinyinEl.textContent = result.pinyin || toPinyinWithTones(word);
      pinyinEl.hidden = !pinyinEl.textContent;
    }
    meaningEl.textContent = result.meaning || "번역을 가져오지 못했습니다.";
    linksEl.innerHTML = `
      <a href="${naverDictUrl(word)}" target="_blank" rel="noopener noreferrer">네이버 사전</a>
      <a href="${papagoUrl(word)}" target="_blank" rel="noopener noreferrer">Papago</a>
      <a href="${googleTranslateUrl(word)}" target="_blank" rel="noopener noreferrer">Google</a>
    `;
  } catch {
    meaningEl.textContent = "번역을 가져오지 못했습니다.";
  } finally {
    popoverBusy = false;
    positionPopover(el, x, y);
  }
}

/** @param {HTMLElement} el @param {number} x @param {number} y */
function positionPopover(el, x, y) {
  const pad = 12;
  const rect = el.getBoundingClientRect();
  let left = x + 8;
  let top = y + 12;
  if (left + rect.width > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - rect.width - pad);
  }
  if (top + rect.height > window.innerHeight - pad) {
    top = Math.max(pad, y - rect.height - 8);
  }
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

/** @param {MouseEvent} e @param {HTMLElement} root */
export function textFromReaderClick(e, root) {
  const sel = window.getSelection()?.toString().trim();
  if (sel) return sel;

  const range =
    document.caretRangeFromPoint?.(e.clientX, e.clientY) ??
    (() => {
      const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY);
      if (!pos) return null;
      const r = document.createRange();
      r.setStart(pos.offsetNode, pos.offset);
      r.setEnd(pos.offsetNode, pos.offset);
      return r;
    })();

  if (!range || !root.contains(range.startContainer)) return "";

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return "";
  const content = node.textContent ?? "";
  const i = range.startOffset;

  if (hasChinese(content)) {
    let start = i;
    let end = i;
    while (start > 0 && /[\u4e00-\u9fff]/.test(content[start - 1] ?? "")) start -= 1;
    while (end < content.length && /[\u4e00-\u9fff]/.test(content[end] ?? "")) end += 1;
    const chunk = content.slice(start, end);
    if (chunk.length <= 8) return chunk;
    return content.slice(Math.max(0, i - 1), Math.min(content.length, i + 2)).replace(/[^\u4e00-\u9fff]/g, "");
  }

  const before = content.slice(0, i);
  const after = content.slice(i);
  const pre = before.match(/[A-Za-z'-]+$/)?.[0] ?? "";
  const post = after.match(/^[A-Za-z'-]+/)?.[0] ?? "";
  return (pre + post).trim();
}

/** @param {string} raw */
export function renderReaderHtml(raw) {
  const paras = raw
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paras.length) {
    return `<p class="entry-preview__reader-empty">본문을 불러오지 못했습니다. 원본 보기로 전환해 보세요.</p>`;
  }
  return paras
    .map((p) => {
      const safe = p
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      return `<p>${safe.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}
