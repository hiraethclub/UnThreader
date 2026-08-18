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

  var api = {
    __v: 1,
    ping: function () { return 'ok'; },

    getSession: function () {
      // Logged-in users have a profile link (/@handle) in the primary nav.
      var links = Array.prototype.slice.call(document.querySelectorAll('a[href^="/@"]'));
      var handle = null;
      for (var i = 0; i < links.length; i++) {
        var h = links[i].getAttribute('href');
        if (h && /^\\/@[^\\/]+\\/?$/.test(h)) { handle = h.replace(/[\\/@]/g, ''); break; }
      }
      var loginBtn = findByText(document, ['log in', 'sign up', 'continue with']);
      var loggedIn = !!handle || (!loginBtn && /threads\\.net\\/@/.test(location.href));
      return { loggedIn: loggedIn, username: handle };
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
