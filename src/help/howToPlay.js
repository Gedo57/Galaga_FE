import './howToPlay.css';

/**
 * Choose a fixed-position help button that does not cover visible controls.
 * Side-by-side with the current sound/settings button is preferred on every
 * viewport; fallback positions are checked against other interactive buttons.
 */
export function chooseHelpPlacement({ width, height, buttonWidth = 44, buttonHeight = 44, audioRect = null, blockedRects = [] }) {
  const gap = 12, edge = 9;
  const candidates = [];
  const offer = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) candidates.push({ x, y }); };
  if (audioRect) {
    const midY = audioRect.top + (audioRect.bottom - audioRect.top - buttonHeight) / 2;
    const midX = audioRect.left + (audioRect.right - audioRect.left - buttonWidth) / 2;
    // On a right-aligned audio icon, the right side may be available (Ship);
    // otherwise put Help immediately to its left (Pinball, Tower, etc.).
    offer(audioRect.right + gap, midY);
    offer(audioRect.left - gap - buttonWidth, midY);
    offer(midX, audioRect.bottom + gap);
    offer(midX, audioRect.top - gap - buttonHeight);
  }
  for (const y of [edge, 64, 120]) {
    offer(width - edge - buttonWidth, y);
    offer(edge, y);
  }
  for (const y of [height - edge - buttonHeight, height - 72 - buttonHeight]) {
    offer(width - edge - buttonWidth, y);
    offer(edge, y);
  }
  const allBlocked = audioRect ? [...blockedRects, audioRect] : blockedRects;
  const overlap = (a, b) => a.x < b.right + 7 && a.x + buttonWidth > b.left - 7 &&
    a.y < b.bottom + 7 && a.y + buttonHeight > b.top - 7;
  let best = null, lowest = Infinity;
  for (const candidate of candidates) {
    if (candidate.x < edge || candidate.y < edge ||
        candidate.x + buttonWidth > width - edge || candidate.y + buttonHeight > height - edge) continue;
    const collisions = allBlocked.reduce((count, rect) => count + (overlap(candidate, rect) ? 1 : 0), 0);
    if (collisions === 0) return candidate;
    if (collisions < lowest) { lowest = collisions; best = candidate; }
  }
  return best || { x: Math.max(edge, width - edge - buttonWidth), y: edge };
}

/**
 * Persistent, presentation-only help control.
 * Deliberately does not navigate, change gameplay state or call wallet APIs.
 * Existing illustrated tutorials are reused by providing their slide paths.
 */
export function installHowToPlay({ title, steps, tips, slideCount = 0, slidePath, audioSelectors = [] } = {}) {
  if (!document.body || document.getElementById('gp-how-to-play-trigger')) return;
  if (typeof title !== 'string' || !Array.isArray(steps) || !Array.isArray(tips) ||
      steps.length === 0 || tips.length === 0) throw new TypeError('How to Play content is required');

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const trigger = make('button', 'gp-help-trigger', '?');
  trigger.id = 'gp-how-to-play-trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'How to Play');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.title = 'How to Play';

  const backdrop = make('div', 'gp-help-backdrop');
  backdrop.hidden = true;
  const dialog = make('section', 'gp-help-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'gp-how-to-play-title');
  dialog.tabIndex = -1;
  const header = make('header', 'gp-help-header');
  const heading = make('h2', 'gp-help-title', 'How to Play');
  heading.id = 'gp-how-to-play-title';
  const closeButton = make('button', 'gp-help-close', '×');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close How to Play');
  header.append(heading, closeButton);
  dialog.append(header);
  dialog.append(make('p', 'gp-help-game-title', title));

  let slideIndex = 0;
  let slideImage;
  let slideLabel;
  let prev;
  let next;
  const withSlides = Number.isInteger(slideCount) && slideCount > 0 && typeof slidePath === 'function';
  if (withSlides) {
    dialog.append(make('p', 'gp-help-section-title', 'Original game tutorial'));
    const slideBox = make('div', 'gp-help-slide-box');
    slideImage = make('img', 'gp-help-slide-image');
    slideImage.alt = 'Illustrated game tutorial';
    slideImage.decoding = 'async';
    slideBox.append(slideImage);
    dialog.append(slideBox);
    const nav = make('div', 'gp-help-slide-nav');
    prev = make('button', 'gp-help-nav-button', 'Previous');
    next = make('button', 'gp-help-nav-button', 'Next');
    prev.type = 'button';
    next.type = 'button';
    slideLabel = make('span', 'gp-help-slide-label');
    nav.append(prev, slideLabel, next);
    dialog.append(nav);
    const updateSlide = () => {
      const orientation = window.matchMedia?.('(orientation: portrait)').matches ? 'portrait' : 'landscape';
      slideImage.src = slidePath(orientation, slideIndex + 1);
      slideImage.alt = title + ': tutorial page ' + (slideIndex + 1) + ' of ' + slideCount;
      slideLabel.textContent = (slideIndex + 1) + ' / ' + slideCount;
      prev.disabled = slideIndex === 0;
      next.disabled = slideIndex === slideCount - 1;
    };
    prev.addEventListener('click', () => { slideIndex = Math.max(0, slideIndex - 1); updateSlide(); });
    next.addEventListener('click', () => { slideIndex = Math.min(slideCount - 1, slideIndex + 1); updateSlide(); });
    window.addEventListener('resize', () => { if (!backdrop.hidden) updateSlide(); }, { passive: true });
    dialog._updateHelpSlide = updateSlide;
  }

  const buildList = (items, listTag) => {
    const list = make(listTag, 'gp-help-list');
    for (const item of items) list.append(make('li', '', item));
    return list;
  };
  dialog.append(make('h3', 'gp-help-section-title', 'Quick rules'));
  dialog.append(buildList(steps, 'ol'));
  dialog.append(make('h3', 'gp-help-section-title', 'Tips'));
  dialog.append(buildList(tips, 'ul'));
  const footer = make('p', 'gp-help-footer', 'Close this panel to return to your game.');
  dialog.append(footer);
  backdrop.append(dialog);
  document.body.append(trigger, backdrop);

  // The original fixed top-right location overlapped sound buttons and native
  // game controls. Query the *currently visible* sound/settings button instead.
  // This also handles React remounts, SPA screen changes and device rotation.
  const selectors = Array.isArray(audioSelectors) ? audioSelectors.filter(Boolean) : [];
  const selector = selectors.join(',');
  const isVisibleControl = (element) => {
    if (!element?.isConnected || element === trigger || element.closest('.gp-help-backdrop')) return false;
    if (element.closest('[hidden],[aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const r = element.getBoundingClientRect();
    return r.width >= 12 && r.height >= 12 && r.left < window.innerWidth &&
      r.right > 0 && r.top < window.innerHeight && r.bottom > 0;
  };
  const rectangle = (element) => {
    const r = element.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  let layoutFrame = 0;
  const positionTrigger = () => {
    layoutFrame = 0;
    if (!trigger.isConnected) return;
    const openAudio = document.querySelector(
      '.audio-settings.is-open, .global-audio-controls.is-open, ' +
      '.audio-settings-overlay.is-open, .settings-overlay.is-open, ' +
      '.desktop-menu-settings-panel, .mobile-menu-settings-panel'
    );
    // Do not cover an expanded native sound/settings panel.
    const audioPanelOpen = Boolean(openAudio && isVisibleControl(openAudio));
    trigger.style.setProperty('visibility', audioPanelOpen ? 'hidden' : 'visible', 'important');
    const audio = selector
      ? [...document.querySelectorAll(selector)].find(isVisibleControl)
      : null;
    const blocked = [...document.querySelectorAll('button, [role="button"], input[type="button"]')]
      .filter(node => node !== trigger && isVisibleControl(node))
      .map(rectangle);
    const rect = trigger.getBoundingClientRect();
    const pos = chooseHelpPlacement({
      width: window.innerWidth,
      height: window.innerHeight,
      buttonWidth: rect.width || 44,
      buttonHeight: rect.height || 44,
      audioRect: audio ? rectangle(audio) : null,
      blockedRects: blocked
    });
    trigger.style.setProperty('left', Math.round(pos.x) + 'px', 'important');
    trigger.style.setProperty('right', 'auto', 'important');
    trigger.style.setProperty('top', Math.round(pos.y) + 'px', 'important');
    trigger.style.setProperty('bottom', 'auto', 'important');
  };
  const schedulePosition = () => {
    if (layoutFrame) return;
    layoutFrame = window.requestAnimationFrame(positionTrigger);
  };
  window.addEventListener('resize', schedulePosition, { passive: true });
  window.addEventListener('orientationchange', schedulePosition, { passive: true });
  document.addEventListener('fullscreenchange', schedulePosition);
  // Child replacement is common in Galaga and Whack; class/hidden changes are
  // common in the other games. Never observe our own inline style mutations.
  const audioLayoutObserver = new MutationObserver(schedulePosition);
  audioLayoutObserver.observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'hidden', 'aria-hidden', 'data-state', 'data-page']
  });
  schedulePosition();


  let returnFocus = null;
  function close() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    (returnFocus?.isConnected ? returnFocus : trigger).focus({ preventScroll: true });
  }
  function open() {
    if (!backdrop.hidden) return;
    returnFocus = document.activeElement;
    slideIndex = 0;
    dialog._updateHelpSlide?.();
    backdrop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    closeButton.focus({ preventScroll: true });
  }

  trigger.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  // Keep game keyboard, shooting/tap and flipper listeners from receiving
  // interactions with the modal. Game timers and network sessions are untouched.
  const stopWhileOpen = (event) => {
    if (backdrop.hidden) return;
    if (event.type === 'keydown') {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'Tab') {
        const controls = [closeButton, ...(withSlides ? [prev, next].filter(b => !b.disabled) : [])];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      } else if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) &&
                 !['BUTTON'].includes(document.activeElement?.tagName)) event.preventDefault();
    }
    event.stopImmediatePropagation();
  };
  document.addEventListener('keydown', stopWhileOpen, true);
  document.addEventListener('keyup', stopWhileOpen, true);
  for (const element of [trigger, backdrop]) {
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) {
      element.addEventListener(name, event => event.stopPropagation());
    }
  }
  return Object.freeze({ open, close });
}
