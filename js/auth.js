/**
 * Firebase Authentication — Google 로그인
 */

/** @type {import('firebase/auth').Auth | null} */
let _auth = null;
/** @type {import('firebase/auth').User | null} */
let _currentUser = null;
/** @type {((user: import('firebase/auth').User | null) => void)[]} */
const _listeners = [];

export function getAuth() {
  return _auth;
}

export function getCurrentUser() {
  return _currentUser;
}

export function onAuthChange(fn) {
  _listeners.push(fn);
  return () => {
    const i = _listeners.indexOf(fn);
    if (i >= 0) _listeners.splice(i, 1);
  };
}

function _notify(user) {
  _currentUser = user;
  for (const fn of _listeners) fn(user);
}

export async function initAuth(firebaseApp) {
  const { getAuth: gAuth, onAuthStateChanged } = await import(
    "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js"
  );
  _auth = gAuth(firebaseApp);
  return new Promise((resolve) => {
    let resolved = false;
    onAuthStateChanged(_auth, (user) => {
      _notify(user);
      if (!resolved) { resolved = true; resolve(user); }
    });
    setTimeout(() => {
      if (!resolved) { resolved = true; resolve(null); }
    }, 5000);
  });
}

export async function signInWithGoogle() {
  const { GoogleAuthProvider, signInWithPopup } = await import(
    "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js"
  );
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(_auth, provider);
  return result.user;
}

export async function signOut() {
  const { signOut: so } = await import(
    "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js"
  );
  await so(_auth);
}
