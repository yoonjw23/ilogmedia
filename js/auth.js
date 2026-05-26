/**
 * Firebase Authentication — Google 로그인
 */
import {
  getAuth as gAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";

let _auth = null;
let _currentUser = null;
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

export function initAuth(firebaseApp) {
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
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(_auth, provider);
  return result.user;
}

export async function signOut() {
  await firebaseSignOut(_auth);
}
