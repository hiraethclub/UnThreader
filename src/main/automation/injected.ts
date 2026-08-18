import { SELECTORS } from './selectors.js'

// The source below is stringified and injected into the Threads guest page. It
// defines `window.__unthreader`, a small DOM library the action modules drive via
// `webContents.executeJavaScript`. Every method returns JSON-serialisable data.
//
// Rects are returned in *viewport* CSS pixels so the main process can dispatch
// real, human-like mouse events at those coordinates over the Chrome DevTools
// Protocol. Methods scroll their target into view before measuring it.
//
// NOTE: this string is plain JS (no TypeScript, no bundler) — it runs verbatim in
// the page. Keep it defensive: never throw, always return a serialisable result.
function runtimeSource(configJson: string): string {
  return `(function () {
  if (window.__unthreader && window.__unthreader.__v === 1) return 'exists';
  var SEL = ${configJson};

  function norm(s) { return (s == null ? '' : String(s)).trim().toLowerCase(); }
  function includesAny(hay, list) { hay = norm(hay); return list.some(function (t) { return hay.indexOf(norm(t)) !== -1; }); }
  function textOf(el) { return norm(el && (el.innerText || el.textContent)); }
  function nameOf(el) {
    if (!el) return '';
    return norm(el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent);
  }
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    var st = window.getComputedStyle(el);
    if (!st || st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }
  function rectOf(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top };
  }
  function clickables(scope) {
    scope = scope || document;
    var sel = 'button,[role="button"],[role="menuitem"],a[href],[tabindex]';
    return Array.prototype.slice.call(scope.querySelectorAll(sel)).filter(isVisible);
  }
  function findByText(scope, texts) {
    var els = clickables(scope);
    for (var i = 0; i < els.length; i++) {
      if (includesAny(textOf(els[i]), texts) || includesAny(nameOf(els[i]), texts)) return els[i];
    }
    return null;
  }
  function topOverlay() {
    // Prefer an open dialog/menu, else the whole document.
    var overlays = Array.prototype.slice.call(
      document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]')
    ).filter(isVisible);
    return overlays.length ? overlays[overlays.length - 1] : null;
  }
  function postContainers() {
    for (var i = 0; i < SEL.postContainers.length; i++) {
      var found = Array.prototype.slice.call(document.querySelectorAll(SEL.postContainers[i])).filter(isVisible);
      if (found.length) return found;
    }
    return [];
  }
  function permalinkIn(el) {
    var a = el.querySelector('a[href*="/post/"]');
    if (a) return a.getAttribute('href');
    var t = el.querySelector('time');
    if (t && t.parentElement && t.parentElement.getAttribute) return t.parentElement.getAttribute('href') || null;
    return null;
  }
  function handleIn(el) {
    var a = el.querySelector('a[href^="/@"]');
    if (a) return a.getAttribute('href').replace(/^\\//, '');
    return null;
  }

  // Finds Threads' own "Profile" navigation control (left rail). Clicking it
  // routes to the logged-in user's OWN profile, so it is our source of truth for
  // "who am I" — far more reliable than guessing a handle from feed anchors.
  function inPost(el) {
    for (var i = 0; i < SEL.postContainers.length; i++) {
      if (el.closest && el.closest(SEL.postContainers[i])) return true;
    }
    return false;
  }
  function labelExact(el, labels) {
    var n = norm(nameOf(el));
    for (var i = 0; i < labels.length; i++) {
      if (n === norm(labels[i])) return true;
    }
    return false;
  }
  function navProfileEl() {
    // A visible nav control whose accessible name is EXACTLY "Profile" and that is
    // not inside a post (so we never match a feed author's profile link).
    var els = Array.prototype.slice.call(
      document.querySelectorAll('a[aria-label],[role="link"][aria-label],[role="button"][aria-label],[role="tab"][aria-label],a[href^="/@"]')
    );
    for (var i = 0; i < els.length; i++) {
      if (isVisible(els[i]) && !inPost(els[i]) && labelExact(els[i], SEL.profileNavLabels)) return els[i];
    }
    return null;
  }
  function navProfileHandle() {
    var el = navProfileEl();
    if (el && el.getAttribute) {
      var h = el.getAttribute('href') || '';
      var m = h.match(/^\\/@([^\\/?#]+)/);
      if (m) return m[1];
    }
    return null;
  }
  function composeEl() {
    var labelled = Array.prototype.slice.call(document.querySelectorAll('[aria-label]'));
    for (var i = 0; i < labelled.length; i++) {
      if (!inPost(labelled[i]) && labelExact(labelled[i], SEL.composeLabels) && isVisible(labelled[i])) return labelled[i];
    }
    return null;
  }
  // "Edit profile" only renders on the logged-in user's own profile, so it is a
  // strong, label-independent confirmation that we are on the right page.
  function hasEditProfile() {
    return !!findByText(document, SEL.editProfileText);
  }

  var api = {
    __v: 1,
    _me: null,
    ping: function () { return 'ok'; },

    getSession: function () {
      var onOwn = hasEditProfile();
      var handle = this._me || navProfileHandle() || (onOwn ? this.currentHandle() : null);
      var loginBtn = findByText(document, ['log in', 'sign up', 'continue with', 'log in with']);
      // Logged-in UI shows the Profile nav, a Create/compose control, or (on your
      // own profile) an Edit-profile button.
      var loggedIn = !!this._me || onOwn || !!navProfileEl() || !!composeEl() || (!loginBtn && !!handle);
      return { loggedIn: loggedIn, username: handle };
    },

    // The @handle in the current URL, or null if not on a profile page.
    currentHandle: function () {
      var m = location.pathname.match(/^\\/@([^\\/]+)/);
      return m ? m[1] : null;
    },

    // Click Threads' Profile nav to route to the user's own profile.
    goToOwnProfile: function () {
      var el = navProfileEl();
      if (!el) return false;
      el.click();
      return true;
    },

    // Record the current profile handle as "me". Trust it when we arrived via the
    // Profile nav or the page shows an Edit-profile button (own-profile proof).
    rememberMe: function () {
      var cur = this.currentHandle();
      if (cur && hasEditProfile()) this._me = cur;
      else if (cur && !this._me) this._me = cur;
      return this._me;
    },

    // True only when the page is the logged-in user's OWN profile. Safety gate:
    // accept when the URL handle matches "me", OR the Edit-profile button is present.
    isOwnProfile: function () {
      var cur = this.currentHandle();
      if (!cur) return false;
      if (hasEditProfile()) return true;
      var me = this._me || navProfileHandle();
      return !!me && norm(cur) === norm(me);
    },

    activateTab: function (kind) {
      var texts = kind === 'replies' ? SEL.tabs.replies : SEL.tabs.posts;
      // Tabs are usually role="tab" or plain links under the profile header.
      var tabs = Array.prototype.slice.call(
        document.querySelectorAll('[role="tab"],a[href*="/@"]')
      ).filter(isVisible);
      for (var i = 0; i < tabs.length; i++) {
        if (includesAny(textOf(tabs[i]), texts) || includesAny(nameOf(tabs[i]), texts)) {
          tabs[i].click();
          return true;
        }
      }
      return false;
    },

    // Returns the "..." menu button rect for the first not-yet-handled post.
    firstItemMenuRect: function () {
      var items = postContainers();
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        if (el.getAttribute('data-unthreader-skip') === '1') continue;
        var btn = null;
        var cand = el.querySelectorAll('[aria-label],[role="button"],button,svg');
        for (var j = 0; j < cand.length; j++) {
          var c = cand[j];
          var clickTarget = (c.tagName === 'SVG' || c.tagName === 'svg')
            ? (c.closest('[role="button"],button,a') || c) : c;
          if (includesAny(nameOf(c), SEL.postMenuButtonLabels) && isVisible(clickTarget)) { btn = clickTarget; break; }
        }
        if (btn) {
          var id = permalinkIn(el) || ('post#' + i);
          return { ok: true, id: id, rect: rectOf(btn) };
        }
      }
      return { ok: false };
    },

    // Marks the first pending post as handled (used by dry-run to enumerate).
    markFirstItem: function () {
      var items = postContainers();
      for (var i = 0; i < items.length; i++) {
        if (items[i].getAttribute('data-unthreader-skip') === '1') continue;
        var id = permalinkIn(items[i]) || ('post#' + i);
        items[i].setAttribute('data-unthreader-skip', '1');
        return { ok: true, id: id };
      }
      return { ok: false };
    },

    menuItemRect: function (kind) {
      var texts = kind === 'delete' ? SEL.deleteMenuItemText : SEL.deleteMenuItemText;
      var scope = topOverlay() || document;
      var el = findByText(scope, texts);
      return el ? { ok: true, rect: rectOf(el) } : { ok: false };
    },

    confirmRect: function (kind) {
      var map = { delete: SEL.confirmDeleteText, unfollow: SEL.confirmUnfollowText, remove: SEL.confirmRemoveText };
      var scope = topOverlay() || document;
      var el = findByText(scope, map[kind] || SEL.confirmDeleteText);
      return el ? { ok: true, rect: rectOf(el) } : { ok: false };
    },

    openFollowDialog: function (kind) {
      var texts = kind === 'followers' ? SEL.followersLinkText : SEL.followingLinkText;
      var links = clickables(document);
      for (var i = 0; i < links.length; i++) {
        if (includesAny(textOf(links[i]), texts)) { links[i].click(); return true; }
      }
      return false;
    },

    // First actionable row inside the open follow/followers dialog.
    firstRowActionRect: function (kind) {
      var dialog = topOverlay();
      if (!dialog) return { ok: false };
      var texts = kind === 'remove' ? SEL.removeButtonText : SEL.followingButtonText;
      var btns = clickables(dialog);
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var row = b.closest('[data-unthreader-skip]');
        if (row) continue;
        if (includesAny(textOf(b), texts)) {
          var container = b.closest('div');
          var id = (container && handleIn(container)) || ('row#' + i);
          return { ok: true, id: id, rect: rectOf(b) };
        }
      }
      return { ok: false };
    },

    markFirstRow: function (kind) {
      var dialog = topOverlay();
      if (!dialog) return { ok: false };
      var texts = kind === 'remove' ? SEL.removeButtonText : SEL.followingButtonText;
      var btns = clickables(dialog);
      for (var i = 0; i < btns.length; i++) {
        if (includesAny(textOf(btns[i]), texts)) {
          var container = btns[i].closest('div');
          var id = (container && handleIn(container)) || ('row#' + i);
          if (container) container.setAttribute('data-unthreader-skip', '1');
          return { ok: true, id: id };
        }
      }
      return { ok: false };
    },

    detectRateWall: function () {
      var body = norm(document.body ? document.body.innerText : '');
      for (var i = 0; i < SEL.rateWallText.length; i++) {
        if (body.indexOf(norm(SEL.rateWallText[i])) !== -1) return SEL.rateWallText[i];
      }
      return null;
    },

    // Returns the current scroll height of the feed or the open dialog's scroller.
    measure: function (kind) {
      if (kind === 'dialog') {
        var dialog = topOverlay();
        if (!dialog) return 0;
        var nodes = dialog.querySelectorAll('*');
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].scrollHeight > nodes[i].clientHeight + 20) return nodes[i].scrollHeight;
        }
        return dialog.scrollHeight;
      }
      return document.body.scrollHeight;
    },

    scrollFeed: function () {
      var before = document.body.scrollHeight;
      window.scrollBy(0, Math.round(window.innerHeight * 0.9));
      return { height: before };
    },

    scrollDialog: function () {
      var dialog = topOverlay();
      if (!dialog) return { height: 0 };
      // Find the scrollable descendant.
      var nodes = dialog.querySelectorAll('*');
      var scroller = dialog;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].scrollHeight > nodes[i].clientHeight + 20) { scroller = nodes[i]; break; }
      }
      var before = scroller.scrollHeight;
      scroller.scrollTop = scroller.scrollTop + Math.round(scroller.clientHeight * 0.9);
      return { height: before };
    },

    closeOverlays: function () {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
      return true;
    }
  };

  window.__unthreader = api;
  return 'ok';
})();`
}

/** The full script to inject once per navigation. */
export const INJECTED_RUNTIME = runtimeSource(JSON.stringify(SELECTORS))
